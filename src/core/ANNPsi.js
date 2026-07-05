/**
 * ANNPsi.js — FUSIONARY Backbone (v1.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * 14-layer scientific-research-specialised backbone (extends predator v2.0).
 *
 * Layer plan:
 *   L1-L2   Hybrid AJN     — sensory encoding of fusion literature stimuli
 *   L3      Hetero AJN K=8  — concept features (confinement modes, fuels, ...)
 *   L4-L5   Transformer     — cross-document context attention
 *   L6      Hetero AJN K=16 — mid-level concepts (reactor classes, breeder designs)
 *   L7      Hybrid AJN     — modulation (resource feasibility gating)
 *   L8-L9   Transformer     — reasoning over hypothesis chains
 *   L10     Hetero AJN K=32 — high-order patent-eligible concept clusters
 *   L11     Hybrid AJN     — praxic assembly (design synthesis)
 *   L12     Hetero AJN K=8  — patent claim assembly (novelty / non-obviousness)
 *   L13     Hybrid AJN     — document structuring (TeX section plan)
 *   L14     Output AJN     — TPS emission (research action stream)
 *
 * Inherits the real multi-head self-attention TransformerBlock from predator v2.0.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import {
  HomogeneousAJNLayer,
  HeterogeneousAJNLayer,
  HybridAJNLayer,
} from '../layers/AJNLayer.js';
import { TransformerBlock } from '../layers/TransformerBlock.js';

// FUSIONARY stimulus classes — one per research subdomain
export const FUSION_STIMULUS_CLASSES = Object.freeze([
  'magnetic_confinement_tokamak',
  'magnetic_confinement_stellarator',
  'inertial_confinement_laser',
  'inertial_confinement_zpinch',
  'magneto_inertial_fusion',
  'aneutronic_pb11',
  'aneutronic_he3',
  'muon_catalyzed',
  'tritium_breeding',
  'plasma_facing_components',
  'superconducting_magnets',
  'diagnostics_control',
  'energy_extraction',
  'neutronics_shielding',
  'fuel_cycle',
  'reactor_economics',
  'patent_drafting',
  'cross_cutting_feasibility',
]);

export class ANNPsi extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.id        = opts.id ?? uuidv4();
    this.dModel    = opts.dModel ?? 256;
    this.nHeads    = opts.nHeads ?? 8;
    this.dFF       = opts.dFF ?? 1024;
    this.maxSteps  = opts.maxSteps ?? 200;

    // Build the 14-layer backbone
    this.layers = [];

    // L1-L2: Hybrid AJN (sensory encoding)
    this.layers.push(new HybridAJNLayer({
      id: 'L1_sensory_hybrid',
      dModel: this.dModel,
      stimulusClass: FUSION_STIMULUS_CLASSES[0],
    }));
    this.layers.push(new HybridAJNLayer({
      id: 'L2_sensory_hybrid',
      dModel: this.dModel,
      stimulusClass: FUSION_STIMULUS_CLASSES[1],
    }));

    // L3: Hetero AJN K=8
    this.layers.push(new HeterogeneousAJNLayer({
      id: 'L3_concept_features',
      dModel: this.dModel,
      kClasses: 8,
      stimulusClasses: FUSION_STIMULUS_CLASSES.slice(0, 8),
    }));

    // L4-L5: Transformer
    this.layers.push(new TransformerBlock({
      id: 'L4_context_attn',
      dModel: this.dModel,
      nHeads: this.nHeads,
      dFF: this.dFF,
    }));
    this.layers.push(new TransformerBlock({
      id: 'L5_context_attn',
      dModel: this.dModel,
      nHeads: this.nHeads,
      dFF: this.dFF,
    }));

    // L6: Hetero AJN K=16
    this.layers.push(new HeterogeneousAJNLayer({
      id: 'L6_reactor_concepts',
      dModel: this.dModel,
      kClasses: 16,
      stimulusClasses: FUSION_STIMULUS_CLASSES,
    }));

    // L7: Hybrid AJN (modulation)
    this.layers.push(new HybridAJNLayer({
      id: 'L7_feasibility_gate',
      dModel: this.dModel,
      stimulusClass: 'cross_cutting_feasibility',
    }));

    // L8-L9: Transformer (reasoning)
    this.layers.push(new TransformerBlock({
      id: 'L8_reasoning',
      dModel: this.dModel,
      nHeads: this.nHeads,
      dFF: this.dFF,
    }));
    this.layers.push(new TransformerBlock({
      id: 'L9_reasoning',
      dModel: this.dModel,
      nHeads: this.nHeads,
      dFF: this.dFF,
    }));

    // L10: Hetero AJN K=32 (high-order patent clusters)
    this.layers.push(new HeterogeneousAJNLayer({
      id: 'L10_patent_clusters',
      dModel: this.dModel,
      kClasses: 32,
      stimulusClasses: FUSION_STIMULUS_CLASSES,
    }));

    // L11: Hybrid AJN (praxic assembly)
    this.layers.push(new HybridAJNLayer({
      id: 'L11_design_assembly',
      dModel: this.dModel,
      stimulusClass: 'cross_cutting_feasibility',
    }));

    // L12: Hetero AJN K=8 (patent claim assembly)
    this.layers.push(new HeterogeneousAJNLayer({
      id: 'L12_patent_claims',
      dModel: this.dModel,
      kClasses: 8,
      stimulusClasses: FUSION_STIMULUS_CLASSES.slice(0, 8),
    }));

    // L13: Hybrid AJN (document structuring)
    this.layers.push(new HybridAJNLayer({
      id: 'L13_document_structuring',
      dModel: this.dModel,
      stimulusClass: 'patent_drafting',
    }));

    // L14: Output AJN (TPS emission) — Homogeneous for clean output
    this.layers.push(new HomogeneousAJNLayer({
      id: 'L14_output_tps',
      dModel: this.dModel,
      stimulusClass: 'cross_cutting_feasibility',
    }));

    this.cascadeRisk = 0;
    this.step = 0;
  }

  /** Forward pass: stimulus -> TPS vector */
  forward(stimulus) {
    let x = stimulus;
    const layerOutputs = [];
    for (const layer of this.layers) {
      try {
        x = layer.forward(x);
        layerOutputs.push({ id: layer.id, output: x });
      } catch (err) {
        this.emit('layerError', { layerId: layer.id, error: err.message });
        // Continue with zeros to prevent cascade
        x = { vector: new Float64Array(this.dModel) };
      }
    }
    this.step++;
    return { tps: x, layerOutputs };
  }

  /** Train one step using backprop-like signal from reward */
  train(stimulus, reward) {
    const result = this.forward(stimulus);
    // Push reward signal back through layers (simplified)
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const layer = this.layers[i];
      if (typeof layer.update === 'function') {
        layer.update(reward);
      }
    }
    return result;
  }

  status() {
    return {
      id: this.id,
      step: this.step,
      layers: this.layers.length,
      cascadeRisk: this.cascadeRisk,
      layerSnapshots: this.layers.map(l =>
        typeof l.snapshot === 'function' ? l.snapshot() : { id: l.id }
      ),
    };
  }

  serialize() {
    return {
      id: this.id,
      dModel: this.dModel,
      nHeads: this.nHeads,
      dFF: this.dFF,
      step: this.step,
      cascadeRisk: this.cascadeRisk,
      layers: this.layers.map(l =>
        typeof l.serialize === 'function' ? l.serialize() : { id: l.id }
      ),
    };
  }

  deserialize(state) {
    this.id = state.id ?? this.id;
    this.step = state.step ?? 0;
    this.cascadeRisk = state.cascadeRisk ?? 0;
    if (state.layers && Array.isArray(state.layers)) {
      for (let i = 0; i < Math.min(state.layers.length, this.layers.length); i++) {
        const layerState = state.layers[i];
        const layer = this.layers[i];
        if (layer && typeof layer.deserialize === 'function') {
          layer.deserialize(layerState);
        }
      }
    }
  }
}
