/**
 * LLMRouter.js — FUSIONARY (v1.0)
 * Multi-LLM adapter with automatic failover. Tries adapters in
 * priority order until one succeeds. Tracks per-adapter success
 * rates and demotes failing adapters.
 */

import { EventEmitter } from 'eventemitter3';
import { LLMAdapter } from './LLMAdapter.js';

export class LLMRouter extends LLMAdapter {
  constructor(opts = {}) {
    super(opts);
    this.adapters = [];   // [{ adapter, priority, successes, failures, lastErrorAt }]
    this.minRetryMs = opts.minRetryMs ?? 30_000; // demoted adapter retries after 30s
  }

  register(adapter, priority = 100) {
    if (!(adapter instanceof LLMAdapter)) {
      throw new Error('Must register an LLMAdapter instance');
    }
    this.adapters.push({
      adapter,
      priority,
      successes: 0,
      failures: 0,
      lastErrorAt: 0,
    });
    this.adapters.sort((a, b) => a.priority - b.priority);
  }

  _eligible() {
    const now = Date.now();
    return this.adapters.filter(a =>
      a.failures === 0 || (now - a.lastErrorAt) > this.minRetryMs
    );
  }

  async chat(prompt, systemPrompt) {
    const eligible = this._eligible();
    if (eligible.length === 0) {
      return {
        ok: false,
        error: 'All LLM adapters are unavailable',
        content: '',
        timestamp: Date.now(),
      };
    }
    for (const entry of eligible) {
      const r = await entry.adapter.chat(prompt, systemPrompt);
      if (r?.ok) {
        entry.successes++;
        return { ...r, adapterUsed: entry.adapter.constructor.name };
      }
      entry.failures++;
      entry.lastErrorAt = Date.now();
    }
    return {
      ok: false,
      error: 'All eligible LLM adapters failed',
      content: '',
      timestamp: Date.now(),
    };
  }

  async embed(text) {
    const eligible = this._eligible();
    for (const entry of eligible) {
      const r = await entry.adapter.embed(text);
      if (r?.ok) return r;
    }
    return { ok: false, error: 'No adapter could embed' };
  }

  status() {
    return this.adapters.map(a => ({
      adapter: a.adapter.constructor.name,
      model: a.adapter.model,
      priority: a.priority,
      successes: a.successes,
      failures: a.failures,
      lastErrorAt: a.lastErrorAt || null,
    }));
  }
}
