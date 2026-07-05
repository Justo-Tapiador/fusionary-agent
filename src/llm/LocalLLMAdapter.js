/**
 * LocalLLMAdapter.js — FUSIONARY (v1.0)
 * Adapter for local LLMs running on Ollama or llama.cpp.
 * Useful for air-gapped deployments and for fine-tuned models.
 */

import { LLMAdapter } from './LLMAdapter.js';
import { hashEmbed } from './ZAIAdapter.js';

export class LocalLLMAdapter extends LLMAdapter {
  constructor(opts = {}) {
    super(opts);
    this.model = opts.model ?? 'llama3.1:70b';
    this.endpoint = opts.endpoint ?? 'http://localhost:11434';
  }

  _envelope(ok, extra = {}) {
    return { ok, timestamp: Date.now(), adapter: 'local', model: this.model, ...extra };
  }

  async chat(prompt, systemPrompt) {
    try {
      const r = await fetch(`${this.endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: [
            ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
            { role: 'user', content: prompt },
          ],
          stream: false,
          options: {
            temperature: this.temperature,
            num_predict: this.maxTokens,
          },
        }),
      });
      if (!r.ok) {
        return this._envelope(false, { error: `HTTP ${r.status}`, content: '' });
      }
      const data = await r.json();
      const content = data.message?.content ?? '';
      return this._envelope(true, {
        content,
        usage: { total_duration: data.total_duration },
        finishReason: data.done ? 'stop' : null,
      });
    } catch (err) {
      return this._envelope(false, { error: err.message, content: '' });
    }
  }

  async embed(text) {
    return this._envelope(true, { embedding: hashEmbed(text) });
  }
}
