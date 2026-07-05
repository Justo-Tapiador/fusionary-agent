/**
 * AnthropicAdapter.js — FUSIONARY (v1.0)
 * Optional adapter for Anthropic Claude (Opus / Sonnet) via the
 * official Anthropic API. Requires ANTHROPIC_API_KEY env var.
 *
 * Used as a failover partner to ZAIAdapter when GLM-4.6 is unavailable.
 */

import { LLMAdapter } from './LLMAdapter.js';

export class AnthropicAdapter extends LLMAdapter {
  constructor(opts = {}) {
    super(opts);
    this.model = opts.model ?? 'claude-opus-4-1';
    this.apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    this.endpoint = opts.endpoint ?? 'https://api.anthropic.com/v1/messages';
    this.apiVersion = opts.apiVersion ?? '2023-06-01';
  }

  _envelope(ok, extra = {}) {
    return { ok, timestamp: Date.now(), adapter: 'anthropic', model: this.model, ...extra };
  }

  async chat(prompt, systemPrompt) {
    if (!this.apiKey) {
      return this._envelope(false, { error: 'ANTHROPIC_API_KEY not set', content: '' });
    }
    try {
      const body = {
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        messages: [{ role: 'user', content: prompt }],
      };
      if (systemPrompt) body.system = systemPrompt;

      const r = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': this.apiVersion,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const txt = await r.text();
        return this._envelope(false, { error: `HTTP ${r.status}: ${txt}`, content: '' });
      }
      const data = await r.json();
      const content = data.content?.[0]?.text ?? '';
      return this._envelope(true, {
        content,
        usage: data.usage ?? null,
        finishReason: data.stop_reason ?? null,
      });
    } catch (err) {
      return this._envelope(false, { error: err.message, content: '' });
    }
  }

  async embed(_text) {
    return this._envelope(false, { error: 'Anthropic does not expose a public embeddings endpoint' });
  }
}
