/**
 * TrainingPipeline.js — FUSIONARY (v1.0)
 * 4-phase training pipeline (compatible with predator v2.0 interface).
 */

import { EventEmitter } from 'eventemitter3';

const PHASES = ['I_pretrain', 'II_addiction_seeding', 'III_hierarchical_finetune', 'IV_adversarial'];

export class TrainingPipeline extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.agent = opts.agent ?? null;
    this.epochs = {
      I: opts.epochsI ?? 10,
      II_T1: opts.epochsII_T1 ?? 5,
      II_T2: opts.epochsII_T2 ?? 5,
      II_T3: opts.epochsII_T3 ?? 5,
      III: opts.epochsIII ?? 8,
      IV: opts.epochsIV ?? 6,
    };
    this.enableCheckpoints = opts.enableCheckpoints ?? true;
    this.earlyStoppingPatience = opts.earlyStoppingPatience ?? 5;
  }

  async run() {
    if (!this.agent) throw new Error('No agent attached');
    this.emit('train:start', { phases: PHASES });
    for (const phase of PHASES) {
      await this._runPhase(phase);
    }
    this.emit('train:complete', { phases: PHASES });
    return { ok: true, phases: PHASES };
  }

  async _runPhase(phase) {
    const epochs = this.epochs[phase] ?? 5;
    this.emit('phase:start', { phase, epochs });
    for (let epoch = 0; epoch < epochs; epoch++) {
      // Each epoch: run a research cycle as training signal
      try {
        if (typeof this.agent._runCycle === 'function') {
          await this.agent._runCycle();
        }
      } catch (err) {
        this.emit('phase:error', { phase, epoch, error: err.message });
      }
      this.emit('phase:epoch', { phase, epoch });
    }
    this.emit('phase:complete', { phase });
  }
}
