/**
 * OpenAIAdapter.js — FUSIONARY (v1.0)
 * Optional adapter for OpenAI GPT-class models via the official API.
 * Requires OPENAI_API_KEY env var. Used as a tertiary failover.
 */

import { LLMAdapter } from './LLMAdapter.js';
import { hashEmbed } from './ZAIAdapter.js';

export class OpenAIAdapter extends LLMAdapter {
  constructor(opts = {}) {
    super(opts);
    this.model = opts.model ?? 'gpt-4o';
    this.apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
    this.endpoint = opts.endpoint ?? 'https://api.openai.com/v1/chat/completions';
  }

  _envelope(ok, extra = {}) {
    return { ok, timestamp: Date.now(), adapter: 'openai', model: this.model, ...extra };
  }

  async chat(prompt, systemPrompt) {
    if (!this.apiKey) {
      return this._envelope(false, { error: 'OPENAI_API_KEY not set', content: '' });
    }
    try {
      const messages = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      messages.push({ role: 'user', content: prompt });

      const r = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          max_tokens: this.maxTokens,
          temperature: this.temperature,
        }),
      });
      if (!r.ok) {
        const txt = await r.text();
        return this._envelope(false, { error: `HTTP ${r.status}: ${txt}`, content: '' });
      }
      const data = await r.json();
      const content = data.choices?.[0]?.message?.content ?? '';
      return this._envelope(true, {
        content,
        usage: data.usage ?? null,
        finishReason: data.choices?.[0]?.finish_reason ?? null,
      });
    } catch (err) {
      return this._envelope(false, { error: err.message, content: '' });
    }
  }

  async embed(text) {
    // Fall back to hash embedding for parity with ZAIAdapter.
    if (typeof text !== 'string' || text.length === 0) {
      return this._envelope(false, { error: 'embed() requires a non-empty string' });
    }
    return this._envelope(true, { embedding: hashEmbed(text) });
  }
}
