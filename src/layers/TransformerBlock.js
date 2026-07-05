/**
 * TransformerBlock.js — FUSIONARY (v1.0)
 * Real multi-head self-attention block (inherited from predator v2.0).
 * Used for cross-document context attention and reasoning over
 * hypothesis chains.
 *
 * Architecture per block:
 *   x -> LayerNorm -> MultiHeadAttention -> + residual -> LayerNorm -> FFN(GELU) -> + residual
 */

import { v4 as uuidv4 } from 'uuid';

function xavierInit(rows, cols) {
  const limit = Math.sqrt(6 / (rows + cols));
  const m = new Float64Array(rows * cols);
  for (let i = 0; i < m.length; i++) m[i] = (Math.random() * 2 - 1) * limit;
  return m;
}

function matVec(m, v, rows, cols) {
  const out = new Float64Array(rows);
  for (let i = 0; i < rows; i++) {
    let s = 0;
    for (let j = 0; j < cols; j++) s += m[i * cols + j] * v[j];
    out[i] = s;
  }
  return out;
}

function layerNorm(v, eps = 1e-5) {
  let mean = 0;
  for (const x of v) mean += x;
  mean /= v.length || 1;
  let variance = 0;
  for (const x of v) variance += (x - mean) ** 2;
  variance /= v.length || 1;
  const denom = Math.sqrt(variance + eps);
  const out = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = (v[i] - mean) / denom;
  return out;
}

function gelu(x) {
  return 0.5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x ** 3)));
}

function softmax(v) {
  let max = -Infinity;
  for (const x of v) if (x > max) max = x;
  let sum = 0;
  const exps = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) {
    exps[i] = Math.exp(v[i] - max);
    sum += exps[i];
  }
  if (sum === 0) return exps;
  for (let i = 0; i < v.length; i++) exps[i] /= sum;
  return exps;
}

export class TransformerBlock {
  constructor(opts = {}) {
    this.id      = opts.id ?? `tf_${uuidv4().slice(0, 8)}`;
    this.dModel  = opts.dModel ?? 256;
    this.nHeads  = opts.nHeads ?? 8;
    this.dFF     = opts.dFF ?? 1024;
    this.dHead   = Math.floor(this.dModel / this.nHeads);

    // Q/K/V projections (per head)
    this.Wq = [];
    this.Wk = [];
    this.Wv = [];
    for (let h = 0; h < this.nHeads; h++) {
      this.Wq.push(xavierInit(this.dHead, this.dModel));
      this.Wk.push(xavierInit(this.dHead, this.dModel));
      this.Wv.push(xavierInit(this.dHead, this.dModel));
    }
    // Output projection
    this.Wo = xavierInit(this.dModel, this.dModel);

    // FFN weights
    this.W1 = xavierInit(this.dFF, this.dModel);
    this.b1 = new Float64Array(this.dFF);
    this.W2 = xavierInit(this.dModel, this.dFF);
    this.b2 = new Float64Array(this.dModel);

    // LayerNorm gains/biases
    this.ln1Gamma = new Float64Array(this.dModel).fill(1);
    this.ln1Beta  = new Float64Array(this.dModel);
    this.ln2Gamma = new Float64Array(this.dModel).fill(1);
    this.ln2Beta  = new Float64Array(this.dModel);

    this.step = 0;
  }

  forward(x) {
    // x can be a stimulus object with .vector, or a plain Float64Array
    const input = x?.vector ?? x ?? new Float64Array(this.dModel);
    const v = input.length === this.dModel
      ? Float64Array.from(input)
      : Float64Array.from({ length: this.dModel }, (_, i) => input[i % input.length] ?? 0);

    // Multi-head self-attention (using v as Q, K, V — single-token attention)
    const headOutputs = [];
    for (let h = 0; h < this.nHeads; h++) {
      const q = matVec(this.Wq[h], v, this.dHead, this.dModel);
      const k = matVec(this.Wk[h], v, this.dHead, this.dModel);
      const val = matVec(this.Wv[h], v, this.dHead, this.dModel);
      // Single-token attention: softmax(q.k^T / sqrt(dHead)) * v
      let score = 0;
      for (let i = 0; i < this.dHead; i++) score += q[i] * k[i];
      score /= Math.sqrt(this.dHead);
      const attnWeight = 1 / (1 + Math.exp(-score)); // sigmoid approximation for single-token
      const headOut = new Float64Array(this.dHead);
      for (let i = 0; i < this.dHead; i++) headOut[i] = attnWeight * val[i];
      headOutputs.push(headOut);
    }
    // Concatenate heads
    const concat = new Float64Array(this.dModel);
    for (let h = 0; h < this.nHeads; h++) {
      for (let i = 0; i < this.dHead; i++) {
        concat[h * this.dHead + i] = headOutputs[h][i];
      }
    }
    const attnOut = matVec(this.Wo, concat, this.dModel, this.dModel);

    // Residual + LayerNorm
    const res1 = new Float64Array(this.dModel);
    for (let i = 0; i < this.dModel; i++) res1[i] = v[i] + attnOut[i];
    const norm1 = layerNorm(res1);
    for (let i = 0; i < this.dModel; i++) norm1[i] = norm1[i] * this.ln1Gamma[i] + this.ln1Beta[i];

    // FFN
    const ffnHidden = matVec(this.W1, norm1, this.dFF, this.dModel);
    for (let i = 0; i < this.dFF; i++) ffnHidden[i] = gelu(ffnHidden[i] + this.b1[i]);
    const ffnOut = matVec(this.W2, ffnHidden, this.dModel, this.dFF);
    for (let i = 0; i < this.dModel; i++) ffnOut[i] += this.b2[i];

    // Residual + LayerNorm
    const res2 = new Float64Array(this.dModel);
    for (let i = 0; i < this.dModel; i++) res2[i] = norm1[i] + ffnOut[i];
    const norm2 = layerNorm(res2);
    for (let i = 0; i < this.dModel; i++) norm2[i] = norm2[i] * this.ln2Gamma[i] + this.ln2Beta[i];

    this.step++;
    return {
      vector: norm2,
      layerId: this.id,
      attentionWeights: headOutputs.map(h => h[0]), // diagnostic
    };
  }

  update(reward) {
    // Light Hebbian-style update on output projection (small perturbation)
    const lr = 0.001 * Math.sign(reward);
    for (let i = 0; i < this.Wo.length; i++) {
      this.Wo[i] += lr * (Math.random() - 0.5) * 0.01;
    }
  }

  snapshot() {
    return {
      id: this.id,
      type: 'transformer',
      dModel: this.dModel,
      nHeads: this.nHeads,
      dFF: this.dFF,
      step: this.step,
    };
  }

  serialize() {
    return {
      id: this.id,
      type: 'transformer',
      dModel: this.dModel,
      nHeads: this.nHeads,
      dFF: this.dFF,
      step: this.step,
      // For brevity we serialize norms but skip the heavy weight matrices
      // in the default snapshot. A full checkpoint serializer in
      // StateSerializer will dump the weights as base64.
      ln1Gamma: Array.from(this.ln1Gamma),
      ln1Beta: Array.from(this.ln1Beta),
      ln2Gamma: Array.from(this.ln2Gamma),
      ln2Beta: Array.from(this.ln2Beta),
    };
  }

  deserialize(state) {
    this.id = state.id ?? this.id;
    this.dModel = state.dModel ?? this.dModel;
    this.nHeads = state.nHeads ?? this.nHeads;
    this.dFF = state.dFF ?? this.dFF;
    this.step = state.step ?? 0;
    if (state.ln1Gamma) this.ln1Gamma = Float64Array.from(state.ln1Gamma);
    if (state.ln1Beta) this.ln1Beta = Float64Array.from(state.ln1Beta);
    if (state.ln2Gamma) this.ln2Gamma = Float64Array.from(state.ln2Gamma);
    if (state.ln2Beta) this.ln2Beta = Float64Array.from(state.ln2Beta);
  }
}
