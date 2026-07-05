/**
 * TokenEnergyArbitrator.js + PraxicStreamExecutor.js — FUSIONARY (v1.0)
 * PID-controlled emission rate for praxes, with parallel execution,
 * retry logic, and structured audit log.
 */

import { EventEmitter } from 'eventemitter3';

// ── Token-Energy Arbitrator ──────────────────────────────────────────────────
export class TokenEnergyArbitrator extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.budgetTokens = opts.budgetTokens ?? 100_000;
    this.budgetEnergy = opts.budgetEnergy ?? 1.0;     // Normalised 0-1
    this.tokensUsed = 0;
    this.energyUsed = 0;
    this.kp = opts.kp ?? 0.6;
    this.ki = opts.ki ?? 0.1;
    this.kd = opts.kd ?? 0.05;
    this._integral = 0;
    this._prevError = 0;
    this.emissionRate = 1.0;
  }

  setBudget(tokens, energy) {
    if (typeof tokens === 'number') this.budgetTokens = tokens;
    if (typeof energy === 'number') this.budgetEnergy = energy;
  }

  /** Decide whether to allow a praxis emission of `tokens` tokens and `energy` energy. */
  arbitrate(tokens = 0, energy = 0) {
    const tokenError = 1 - (this.tokensUsed / this.budgetTokens);
    const energyError = 1 - (this.energyUsed / this.budgetEnergy);
    const error = Math.min(tokenError, energyError);

    this._integral += error;
    const derivative = error - this._prevError;
    this._prevError = error;

    const output = this.kp * error + this.ki * this._integral + this.kd * derivative;
    this.emissionRate = Math.max(0, Math.min(1, output));

    const allowed = this.emissionRate > 0.1 && this.tokensUsed + tokens <= this.budgetTokens;
    if (allowed) {
      this.tokensUsed += tokens;
      this.energyUsed += energy;
    }
    this.emit('decision', { allowed, emissionRate: this.emissionRate, tokens, energy });
    return allowed;
  }

  status() {
    return {
      tokensUsed: this.tokensUsed,
      tokensRemaining: Math.max(0, this.budgetTokens - this.tokensUsed),
      energyUsed: this.energyUsed,
      energyRemaining: Math.max(0, this.budgetEnergy - this.energyUsed),
      emissionRate: this.emissionRate,
    };
  }

  reset() {
    this.tokensUsed = 0;
    this.energyUsed = 0;
    this._integral = 0;
    this._prevError = 0;
    this.emissionRate = 1.0;
  }
}

// ── Praxic Stream Executor ──────────────────────────────────────────────────
export class PraxicStreamExecutor extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.registry = opts.registry ?? null;
    this.maxRetries = opts.maxRetries ?? 3;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.auditLog = [];
  }

  /**
   * Execute a praxis (action) by looking up its handler in the registry.
   * @param {object} praxis  – { toolId, args }
   */
  async execute(praxis) {
    if (!this.registry) throw new Error('No tool registry attached');
    const { toolId, args } = praxis;
    const handler = this.registry.get(toolId);
    if (!handler) {
      this._log(praxis, 'error', { error: `Unknown tool: ${toolId}` });
      return { ok: false, error: `Unknown tool: ${toolId}` };
    }

    let attempt = 0;
    let lastError = null;
    while (attempt < this.maxRetries) {
      attempt++;
      try {
        const result = await this._withTimeout(handler(args), this.timeoutMs);
        this._log(praxis, 'success', { attempt, result });
        return { ok: true, result, attempts: attempt };
      } catch (err) {
        lastError = err;
        this._log(praxis, 'retry', { attempt, error: err.message });
        await new Promise(r => setTimeout(r, 100 * 2 ** attempt));
      }
    }
    this._log(praxis, 'failure', { error: lastError?.message ?? 'unknown' });
    return { ok: false, error: lastError?.message ?? 'unknown', attempts: attempt };
  }

  async _withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms)),
    ]);
  }

  _log(praxis, status, extra) {
    this.auditLog.push({
      timestamp: Date.now(),
      toolId: praxis.toolId,
      status,
      ...extra,
    });
    if (this.auditLog.length > 1000) this.auditLog.shift();
    this.emit('audit', { praxis, status, ...extra });
  }
}
