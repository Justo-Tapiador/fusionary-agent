/**
 * AJNLayer.js — FUSIONARY (v1.0)
 * Wrapper classes around the AJN core, providing layer-level abstractions.
 * Compatible interface with predator-jungle-agent v2.0 so existing tools
 * and modules can interoperate, but extended with multi-objective rewards.
 */

import { ArtificialJunkyNeuron, AJNPhase } from '../core/ArtificialJunkyNeuron.js';

// ── Homogeneous AJN layer (all neurons crave the same stimulus class) ──────
export class HomogeneousAJNLayer {
  constructor(opts = {}) {
    this.id             = opts.id ?? `homog_${Math.random().toString(36).slice(2, 8)}`;
    this.dModel         = opts.dModel ?? 256;
    this.stimulusClass  = opts.stimulusClass ?? 'default';
    this.neurons        = [];
    const count = opts.neuronCount ?? 4;
    for (let i = 0; i < count; i++) {
      this.neurons.push(new ArtificialJunkyNeuron({
        id: `${this.id}_n${i}`,
        stimulusClass: this.stimulusClass,
        params: opts.params,
      }));
    }
  }

  forward(stimulus) {
    const outputs = this.neurons.map(n => n.process(stimulus));
    // Aggregate: take the praxis vector with highest alpha
    let best = outputs[0];
    for (const o of outputs) {
      if (o.alpha > best.alpha) best = o;
    }
    return {
      vector: best.praxis,
      alpha: best.alpha,
      phase: best.phase,
      layerId: this.id,
      neuronSnapshots: outputs.map(o => ({
        id: o.id, phase: o.phase, alpha: o.alpha, craving: o.craving,
      })),
    };
  }

  update(reward) {
    for (const n of this.neurons) {
      // Inject reward as delta in the next process cycle
      n.alphaPrev = (n.alphaPrev ?? 0) - reward;
    }
  }

  snapshot() {
    return {
      id: this.id,
      type: 'homogeneous',
      stimulusClass: this.stimulusClass,
      neurons: this.neurons.map(n => n.snapshot()),
    };
  }

  serialize() {
    return {
      id: this.id,
      type: 'homogeneous',
      stimulusClass: this.stimulusClass,
      dModel: this.dModel,
      neurons: this.neurons.map(n => n.serialize()),
    };
  }

  deserialize(state) {
    this.id = state.id ?? this.id;
    this.stimulusClass = state.stimulusClass ?? this.stimulusClass;
    if (state.neurons && Array.isArray(state.neurons)) {
      for (let i = 0; i < Math.min(state.neurons.length, this.neurons.length); i++) {
        this.neurons[i].deserialize(state.neurons[i]);
      }
    }
  }
}

// ── Heterogeneous AJN layer (K classes compete via softmax) ───────────────
export class HeterogeneousAJNLayer {
  constructor(opts = {}) {
    this.id              = opts.id ?? `hetero_${Math.random().toString(36).slice(2, 8)}`;
    this.dModel          = opts.dModel ?? 256;
    this.kClasses        = opts.kClasses ?? 8;
    this.stimulusClasses = opts.stimulusClasses ?? Array.from({ length: this.kClasses }, (_, i) => `class_${i}`);
    this.neurons         = [];
    for (let i = 0; i < this.kClasses; i++) {
      this.neurons.push(new ArtificialJunkyNeuron({
        id: `${this.id}_n${i}`,
        stimulusClass: this.stimulusClasses[i % this.stimulusClasses.length],
        params: opts.params,
      }));
    }
    this.temperature = opts.temperature ?? 1.0;
  }

  forward(stimulus) {
    const outputs = this.neurons.map(n => n.process(stimulus));
    // Softmax over alphas to pick a winning class
    const alphas = outputs.map(o => o.alpha);
    const maxA = Math.max(...alphas);
    const exps = alphas.map(a => Math.exp((a - maxA) / this.temperature));
    const sumExp = exps.reduce((s, v) => s + v, 0) || 1;
    const probs = exps.map(e => e / sumExp);
    const winnerIdx = probs.indexOf(Math.max(...probs));
    const winner = outputs[winnerIdx];
    return {
      vector: winner.praxis,
      alpha: winner.alpha,
      phase: winner.phase,
      layerId: this.id,
      winnerClass: this.stimulusClasses[winnerIdx % this.stimulusClasses.length],
      winnerIdx,
      probabilities: probs,
      neuronSnapshots: outputs.map((o, i) => ({
        id: o.id, phase: o.phase, alpha: o.alpha, prob: probs[i],
      })),
    };
  }

  update(reward) {
    for (const n of this.neurons) {
      n.alphaPrev = (n.alphaPrev ?? 0) - reward;
    }
  }

  snapshot() {
    return {
      id: this.id,
      type: 'heterogeneous',
      kClasses: this.kClasses,
      stimulusClasses: this.stimulusClasses,
      neurons: this.neurons.map(n => n.snapshot()),
    };
  }

  serialize() {
    return {
      id: this.id,
      type: 'heterogeneous',
      kClasses: this.kClasses,
      stimulusClasses: this.stimulusClasses,
      dModel: this.dModel,
      temperature: this.temperature,
      neurons: this.neurons.map(n => n.serialize()),
    };
  }

  deserialize(state) {
    this.id = state.id ?? this.id;
    this.kClasses = state.kClasses ?? this.kClasses;
    this.stimulusClasses = state.stimulusClasses ?? this.stimulusClasses;
    this.temperature = state.temperature ?? this.temperature;
    if (state.neurons && Array.isArray(state.neurons)) {
      for (let i = 0; i < Math.min(state.neurons.length, this.neurons.length); i++) {
        this.neurons[i].deserialize(state.neurons[i]);
      }
    }
  }
}

// ── Hybrid AJN layer (mix of homogeneous + heterogeneous neurons) ─────────
export class HybridAJNLayer {
  constructor(opts = {}) {
    this.id             = opts.id ?? `hybrid_${Math.random().toString(36).slice(2, 8)}`;
    this.dModel         = opts.dModel ?? 256;
    this.stimulusClass  = opts.stimulusClass ?? 'default';
    this.neurons        = [];
    const homCount = opts.homCount ?? 3;
    const hetCount = opts.hetCount ?? 3;
    for (let i = 0; i < homCount; i++) {
      this.neurons.push(new ArtificialJunkyNeuron({
        id: `${this.id}_hom_${i}`,
        stimulusClass: this.stimulusClass,
        params: opts.params,
      }));
    }
    for (let i = 0; i < hetCount; i++) {
      this.neurons.push(new ArtificialJunkyNeuron({
        id: `${this.id}_het_${i}`,
        stimulusClass: `${this.stimulusClass}_variant_${i}`,
        params: opts.params,
      }));
    }
  }

  forward(stimulus) {
    const outputs = this.neurons.map(n => n.process(stimulus));
    // Average the praxis vectors (modulation behaviour)
    const dim = outputs[0]?.praxis?.length ?? this.dModel;
    const aggregated = new Float64Array(dim);
    for (const o of outputs) {
      for (let i = 0; i < Math.min(o.praxis.length, dim); i++) {
        aggregated[i] += o.praxis[i] / outputs.length;
      }
    }
    const avgAlpha = outputs.reduce((s, o) => s + o.alpha, 0) / outputs.length;
    return {
      vector: aggregated,
      alpha: avgAlpha,
      phase: outputs[0]?.phase,
      layerId: this.id,
      neuronSnapshots: outputs.map(o => ({
        id: o.id, phase: o.phase, alpha: o.alpha, craving: o.craving,
      })),
    };
  }

  update(reward) {
    for (const n of this.neurons) {
      n.alphaPrev = (n.alphaPrev ?? 0) - reward;
    }
  }

  snapshot() {
    return {
      id: this.id,
      type: 'hybrid',
      stimulusClass: this.stimulusClass,
      neurons: this.neurons.map(n => n.snapshot()),
    };
  }

  serialize() {
    return {
      id: this.id,
      type: 'hybrid',
      stimulusClass: this.stimulusClass,
      dModel: this.dModel,
      neurons: this.neurons.map(n => n.serialize()),
    };
  }

  deserialize(state) {
    this.id = state.id ?? this.id;
    this.stimulusClass = state.stimulusClass ?? this.stimulusClass;
    if (state.neurons && Array.isArray(state.neurons)) {
      for (let i = 0; i < Math.min(state.neurons.length, this.neurons.length); i++) {
        this.neurons[i].deserialize(state.neurons[i]);
      }
    }
  }
}

export { AJNPhase };
