/**
 * CascadeMonitor.js — FUSIONARY (v1.0)
 * Predictive, self-healing cascade monitor. Detects when neuron
 * extinctions or layer failures are trending toward a cascade and
 * injects learned stimulus patterns to recover.
 */

import { EventEmitter } from 'eventemitter3';

export class CascadeMonitor extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.warnThreshold  = opts.warnThreshold  ?? 0.6;
    this.criticalThreshold = opts.criticalThreshold ?? 0.85;
    this.windowSize     = opts.windowSize ?? 50;
    this.history        = [];
    this.learnedPatterns = new Map();
    this.cascadeRisk    = 0;
  }

  record(event) {
    this.history.push({
      timestamp: Date.now(),
      ...event,
    });
    if (this.history.length > this.windowSize) this.history.shift();
    this._updateRisk();
  }

  _updateRisk() {
    if (this.history.length === 0) {
      this.cascadeRisk = 0;
      return;
    }
    // Risk = weighted combination of failure/extinction events
    const recent = this.history.slice(-this.windowSize);
    const extinctions = recent.filter(e => e.type === 'extinction').length;
    const errors = recent.filter(e => e.type === 'error').length;
    const successes = recent.filter(e => e.type === 'success').length;
    const total = recent.length;
    const failureRate = (extinctions + errors) / total;
    const successRate = successes / total;

    // EMA for smoothing
    const alpha = 0.3;
    this.cascadeRisk = (1 - alpha) * this.cascadeRisk + alpha * (failureRate * 0.8 + (1 - successRate) * 0.2);
    this.cascadeRisk = Math.max(0, Math.min(1, this.cascadeRisk));

    if (this.cascadeRisk > this.criticalThreshold) {
      this.emit('critical', { risk: this.cascadeRisk, extinctions, errors });
    } else if (this.cascadeRisk > this.warnThreshold) {
      this.emit('warning', { risk: this.cascadeRisk, extinctions, errors });
    }
  }

  /** Learn a stimulus pattern that previously led to success. */
  learnPattern(name, pattern) {
    this.learnedPatterns.set(name, {
      pattern,
      learnedAt: Date.now(),
      hits: 0,
    });
    this.emit('patternLearned', { name });
  }

  /** Suggest a recovery pattern. */
  suggestRecovery() {
    if (this.learnedPatterns.size === 0) return null;
    const entries = [...this.learnedPatterns.values()];
    return entries[Math.floor(Math.random() * entries.length)].pattern;
  }

  getCascadeRiskHistory() {
    return this.history.slice(-100);
  }

  status() {
    return {
      cascadeRisk: this.cascadeRisk,
      historyLength: this.history.length,
      learnedPatterns: this.learnedPatterns.size,
    };
  }
}
