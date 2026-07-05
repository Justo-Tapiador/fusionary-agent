/**
 * ArtificialJunkyNeuron.js  (FUSIONARY v1.0 — Enhanced)
 * ─────────────────────────────────────────────────────────────────────────────
 * Core implementation of the Artificial Junky Neuron (AJN) as defined in:
 *
 *   Tapiador García, J. (2024). Agentic Theory: Definition of the
 *   Artificial Junky Neuron (AJN). Preprint WALLERMAX-AI 2604.00012.
 *   Universidad de Alicante (UA).
 *
 * FUSIONARY ENHANCEMENTS over predator-jungle-agent v2.0:
 *   - Domain-specialised stimulus classes for fusion research
 *   - Curiosity bonus when praxis explores under-covered topic regions
 *   - Saturation-aware praxis emission (silent when topic saturated)
 *   - Patentability signal: rewards praxes whose artifact is patent-eligible
 *   - Resource-feasibility weighting: penalises physically-impossible proposals
 *   - Multi-objective reward (quality × novelty × feasibility × patentability)
 *   - Cross-document Hebbian traces for citation graph learning
 *   - Replay buffer stratified by reward quantile
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';

// ── AJN Phase constants ────────────────────────────────────────────────────
export const AJNPhase = Object.freeze({
  RANDOM:       1,   // High-entropy exploration of the fusion knowledge space
  REINFORCE:    2,   // Bias developing toward a high-reward fusion stimulus
  SATURATION:   3,   // Topic sufficiently explored; praxes suppressed
  WITHDRAWAL:   4,   // Craving returns; threshold decays
  FRUSTRATION:  5,   // Failure state; covariance expanding chaotically
  EXTINCTION:   6,   // Addiction dissolved; reset to random exploration
});

// ── Default hyperparameters (tuned for scientific research stability) ──────
const DEFAULTS = {
  betaM:        0.85,   // Exponential smoothing for craving
  lambdaUp:     0.30,   // Saturation ascent rate for threshold
  delta:        0.02,   // Metabolic decay rate (withdrawal speed)
  thetaSat:     0.75,   // Saturation threshold
  tau:          20,     // Extinction horizon (failure steps)
  eta:          0.05,   // Praxic learning rate
  etaMin:       0.001,  // Cosine annealing floor
  lambdaSigma:  0.10,   // Entropy reduction on success
  gamma:        0.15,   // Chaotic expansion rate on failure
  sigmaMax:     2.0,    // Maximum covariance (extinction reset)
  sigmaMin:     1e-4,   // Minimum covariance
  praximDim:    128,    // Larger praxis dim for richer research vectors
  momentumBeta: 0.9,    // Momentum coefficient
  replaySize:   200,    // Doubled replay capacity
  entropyCoeff: 0.01,   // Entropy regularization
  hysteresis:   0.05,   // Phase transition hysteresis band
  hebbianLR:    0.001,  // Hebbian learning rate
  cosinePeriod: 1000,   // Cosine annealing period
  // FUSIONARY-specific
  curiosityWeight:   0.20,  // Weight on novelty in the reward
  feasibilityWeight: 0.30,  // Weight on resource feasibility
  patentWeight:      0.15,  // Weight on patentability
  qualityWeight:     0.35,  // Weight on direct quality signal
};

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

function gaussianSample(mu, sigma) {
  const u1 = Math.random(), u2 = Math.random();
  const z  = Math.sqrt(-2 * Math.log(u1 + 1e-12)) * Math.cos(2 * Math.PI * u2);
  return mu + sigma * z;
}

function cosineAnnealing(step, etaMax, etaMin, period) {
  const progress = (step % period) / period;
  return etaMin + 0.5 * (etaMax - etaMin) * (1 + Math.cos(Math.PI * progress));
}

// ─────────────────────────────────────────────────────────────────────────────
export class ArtificialJunkyNeuron extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string}   [opts.id]
   * @param {string}   [opts.stimulusClass]  – e.g. "magnetic_confinement", "tritium_breeding"
   * @param {Function} [opts.intensityFn]    – I(S) -> [0,1]
   * @param {Function} [opts.rewardFn]       – Multi-objective reward (S, praxis) -> {quality, novelty, feasibility, patentability}
   * @param {object}   [opts.params]
   */
  constructor(opts = {}) {
    super();
    this.id            = opts.id ?? uuidv4();
    this.stimulusClass = opts.stimulusClass ?? 'default';
    this.intensityFn   = opts.intensityFn ?? ((s) => clamp(s?.intensity ?? 0));
    this.rewardFn      = opts.rewardFn ?? null; // FUSIONARY: optional multi-objective reward
    this.p             = { ...DEFAULTS, ...(opts.params ?? {}) };

    // ── State variables ──────────────────────────────────────────────────
    this.M        = 0;          // Craving level
    this.theta    = 0.5;        // Activation threshold
    this.phase    = AJNPhase.RANDOM;

    const d = this.p.praximDim;
    this.mu       = new Float64Array(d);
    this.sigma    = new Float64Array(d).fill(1.0);

    this.muVelocity     = new Float64Array(d);
    this.sigmaVelocity  = new Float64Array(d);

    this.hebbianTrace   = new Float64Array(d);

    this.replayBuffer   = [];

    // Counters
    this.nFail      = 0;
    this.step       = 0;
    this.alphaPrev  = 0;
    this.extinctions = 0;
    this.totalReward = 0;
    this.avgReward   = 0;
    this.lastPraxis  = null;

    // FUSIONARY: track reward components for diagnostics
    this.lastRewardComponents = { quality: 0, novelty: 0, feasibility: 0, patentability: 0 };

    this._phaseConfidence = 0;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Main processing cycle.
   * @param {*} stimulus  – Raw stimulus object
   * @returns {{ praxis: Float64Array, phase: number, alpha: number, craving: number, rewardComponents?: object }}
   */
  process(stimulus) {
    const alpha      = clamp(this.intensityFn(stimulus));
    const deltaAlpha = alpha - this.alphaPrev;

    this.M = clamp(this.p.betaM * this.M + (1 - this.p.betaM) * alpha);

    const eta = cosineAnnealing(
      this.step, this.p.eta, this.p.etaMin, this.p.cosinePeriod
    );

    let praxis;
    let rewardComponents = null;

    if (alpha > this.p.thetaSat + this.p.hysteresis) {
      // Phase 3: SATURATION
      this._setPhase(AJNPhase.SATURATION);
      this.theta = clamp(this.theta + this.p.lambdaUp * alpha);
      this.nFail = 0;
      praxis = new Float64Array(this.p.praximDim);

    } else if (alpha > this.p.thetaSat - this.p.hysteresis &&
               this.phase === AJNPhase.SATURATION) {
      praxis = new Float64Array(this.p.praximDim);

    } else {
      this.theta = clamp(this.theta - this.p.delta);

      if (this.theta < this.M && this.phase === AJNPhase.SATURATION) {
        this._setPhase(AJNPhase.WITHDRAWAL);
      }

      praxis = this._samplePraxis(eta);
      this.lastPraxis = praxis;

      // FUSIONARY: multi-objective reward if available
      if (this.rewardFn) {
        rewardComponents = this.rewardFn(stimulus, praxis);
        // Combine into a scalar signal that drives learning
        const w = this.p;
        const combined =
          w.qualityWeight     * (rewardComponents.quality     ?? 0) +
          w.curiosityWeight   * (rewardComponents.novelty     ?? 0) +
          w.feasibilityWeight * (rewardComponents.feasibility ?? 0) +
          w.patentWeight      * (rewardComponents.patentability ?? 0);
        // Replace deltaAlpha with the combined reward (signed)
        const effectiveDelta = combined - this.alphaPrev;
        this._storeExperience(alpha, effectiveDelta, praxis, rewardComponents);

        if (effectiveDelta > 0) {
          this._setPhase(AJNPhase.REINFORCE);
          this._onSuccess(effectiveDelta, eta);
          this.nFail = 0;
          this.totalReward += effectiveDelta;
        } else {
          this._setPhase(AJNPhase.FRUSTRATION);
          this._onFailure(effectiveDelta, eta);
          this.nFail++;
          if (this.nFail >= this.p.tau) {
            this._extinct();
            praxis = this._samplePraxis(eta);
          }
        }
        this.lastRewardComponents = rewardComponents;
      } else {
        // Legacy single-signal path (predator v2.0 compatible)
        this._storeExperience(alpha, deltaAlpha, praxis);

        if (deltaAlpha > 0) {
          this._setPhase(AJNPhase.REINFORCE);
          this._onSuccess(deltaAlpha, eta);
          this.nFail = 0;
          this.totalReward += deltaAlpha;
        } else {
          this._setPhase(AJNPhase.FRUSTRATION);
          this._onFailure(deltaAlpha, eta);
          this.nFail++;
          if (this.nFail >= this.p.tau) {
            this._extinct();
            praxis = this._samplePraxis(eta);
          }
        }
      }
    }

    this._updateHebbianTrace(alpha, praxis);

    if (this.step % 5 === 0 && this.replayBuffer.length > 10) {
      this._replayExperiences(eta);
    }

    this.alphaPrev = alpha;
    this.step++;
    this.avgReward = this.step > 0 ? this.totalReward / this.step : 0;

    const result = {
      id:      this.id,
      step:    this.step,
      phase:   this.phase,
      alpha,
      craving: this.M,
      theta:   this.theta,
      nFail:   this.nFail,
      praxis,
      praxisNorm: this._norm(praxis),
      eta,
      avgReward: this.avgReward,
      rewardComponents,
    };

    this.emit('step', result);
    return result;
  }

  injectAddictionTarget(prototype) {
    const d = Math.min(prototype.length, this.p.praximDim);
    for (let i = 0; i < d; i++) this.mu[i] = prototype[i];
    this.M = Math.max(this.M, 0.3);
    this.nFail = 0;
    this._phaseConfidence = 0;
    this._setPhase(AJNPhase.REINFORCE);
  }

  snapshot() {
    return {
      id: this.id,
      stimulusClass: this.stimulusClass,
      phase: this.phase,
      phaseName: this._phaseName(),
      M: this.M,
      theta: this.theta,
      nFail: this.nFail,
      step: this.step,
      extinctions: this.extinctions,
      muNorm: this._norm(this.mu),
      sigmaMean: this._mean(this.sigma),
      avgReward: this.avgReward,
      totalReward: this.totalReward,
      rewardComponents: this.lastRewardComponents,
    };
  }

  serialize() {
    return {
      id: this.id,
      stimulusClass: this.stimulusClass,
      phase: this.phase,
      M: this.M,
      theta: this.theta,
      nFail: this.nFail,
      step: this.step,
      extinctions: this.extinctions,
      alphaPrev: this.alphaPrev,
      totalReward: this.totalReward,
      avgReward: this.avgReward,
      mu: Array.from(this.mu),
      sigma: Array.from(this.sigma),
      muVelocity: Array.from(this.muVelocity),
      sigmaVelocity: Array.from(this.sigmaVelocity),
      hebbianTrace: Array.from(this.hebbianTrace),
      params: { ...this.p },
      rewardComponents: this.lastRewardComponents,
    };
  }

  deserialize(state) {
    this.id            = state.id;
    this.stimulusClass = state.stimulusClass ?? this.stimulusClass;
    this.phase         = state.phase ?? AJNPhase.RANDOM;
    this.M             = state.M ?? 0;
    this.theta         = state.theta ?? 0.5;
    this.nFail         = state.nFail ?? 0;
    this.step          = state.step ?? 0;
    this.extinctions   = state.extinctions ?? 0;
    this.alphaPrev     = state.alphaPrev ?? 0;
    this.totalReward   = state.totalReward ?? 0;
    this.avgReward     = state.avgReward ?? 0;

    if (state.mu) this.mu = Float64Array.from(state.mu);
    if (state.sigma) this.sigma = Float64Array.from(state.sigma);
    if (state.muVelocity) this.muVelocity = Float64Array.from(state.muVelocity);
    if (state.sigmaVelocity) this.sigmaVelocity = Float64Array.from(state.sigmaVelocity);
    if (state.hebbianTrace) this.hebbianTrace = Float64Array.from(state.hebbianTrace);
    if (state.params) Object.assign(this.p, state.params);
    if (state.rewardComponents) this.lastRewardComponents = state.rewardComponents;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  _samplePraxis(eta) {
    const praxis = new Float64Array(this.p.praximDim);
    for (let i = 0; i < this.p.praximDim; i++) {
      praxis[i] = gaussianSample(this.mu[i], this.sigma[i]);
    }
    if (this.p.entropyCoeff > 0) {
      for (let i = 0; i < this.p.praximDim; i++) {
        praxis[i] += this.p.entropyCoeff * gaussianSample(0, 1);
      }
    }
    return praxis;
  }

  _onSuccess(deltaAlpha, eta) {
    for (let i = 0; i < this.p.praximDim; i++) {
      const grad = (Math.random() - 0.5) * 2 * deltaAlpha;
      this.muVelocity[i] = this.p.momentumBeta * this.muVelocity[i]
                          + (1 - this.p.momentumBeta) * eta * deltaAlpha * grad;
      this.mu[i] += this.muVelocity[i];

      const sigmaGrad = -this.p.lambdaSigma * deltaAlpha;
      this.sigmaVelocity[i] = this.p.momentumBeta * this.sigmaVelocity[i]
                             + (1 - this.p.momentumBeta) * sigmaGrad;
      this.sigma[i] *= Math.exp(this.sigmaVelocity[i]);
      this.sigma[i]  = clamp(this.sigma[i], this.p.sigmaMin, this.p.sigmaMax);
    }
  }

  _onFailure(deltaAlpha, eta) {
    for (let i = 0; i < this.p.praximDim; i++) {
      const sigmaGrad = this.p.gamma * Math.abs(deltaAlpha);
      this.sigmaVelocity[i] = this.p.momentumBeta * this.sigmaVelocity[i]
                             + (1 - this.p.momentumBeta) * sigmaGrad;
      this.sigma[i] *= Math.exp(this.sigmaVelocity[i]);
      this.sigma[i]  = clamp(this.sigma[i], this.p.sigmaMin, this.p.sigmaMax);
    }
  }

  _extinct() {
    this.mu.fill(0);
    this.sigma.fill(this.p.sigmaMax);
    this.muVelocity.fill(0);
    this.sigmaVelocity.fill(0);
    this.M     = 0;
    this.nFail = 0;
    this.extinctions++;
    this._phaseConfidence = 0;
    this._setPhase(AJNPhase.EXTINCTION);
    this.emit('extinction', { id: this.id, extinctions: this.extinctions, step: this.step });
    setTimeout(() => {
      if (this.phase === AJNPhase.EXTINCTION) this._setPhase(AJNPhase.RANDOM);
    }, 0);
  }

  _updateHebbianTrace(alpha, praxis) {
    if (!praxis || praxis.length === 0) return;
    const lr = this.p.hebbianLR;
    for (let i = 0; i < Math.min(praxis.length, this.hebbianTrace.length); i++) {
      this.hebbianTrace[i] += lr * alpha * praxis[i];
      this.hebbianTrace[i] *= 0.999;
    }
  }

  _storeExperience(alpha, deltaAlpha, praxis, components = null) {
    if (this.replayBuffer.length >= this.p.replaySize) {
      this.replayBuffer.shift();
    }
    this.replayBuffer.push({
      alpha,
      deltaAlpha,
      praxisSnapshot: Float64Array.from(praxis),
      muSnapshot: Float64Array.from(this.mu),
      step: this.step,
      components,
    });
  }

  _replayExperiences(eta) {
    // FUSIONARY: stratified replay — prefer top-quartile reward experiences
    const sorted = [...this.replayBuffer].sort((a, b) => b.deltaAlpha - a.deltaAlpha);
    const topQuartile = sorted.slice(0, Math.max(1, Math.floor(sorted.length / 4)));
    const batchSize = Math.min(5, topQuartile.length);
    for (let i = 0; i < batchSize; i++) {
      const idx = Math.floor(Math.random() * topQuartile.length);
      const exp = topQuartile[idx];
      if (exp.deltaAlpha > 0) {
        for (let j = 0; j < this.p.praximDim; j++) {
          const diff = exp.praxisSnapshot[j] - this.mu[j];
          this.mu[j] += eta * 0.1 * diff * exp.deltaAlpha;
        }
      }
    }
  }

  _setPhase(p) {
    if (this.phase !== p) {
      const prev = this.phase;
      this.phase = p;
      this._phaseConfidence = 0;
      this.emit('phaseChange', { id: this.id, from: prev, to: p });
    } else {
      this._phaseConfidence = Math.min(1, this._phaseConfidence + 0.1);
    }
  }

  _norm(arr) {
    let s = 0;
    for (const v of arr) s += v * v;
    return Math.sqrt(s);
  }

  _mean(arr) {
    let s = 0;
    for (const v of arr) s += v;
    return s / arr.length;
  }

  _phaseName() {
    return Object.keys(AJNPhase).find(k => AJNPhase[k] === this.phase) ?? 'UNKNOWN';
  }
}
