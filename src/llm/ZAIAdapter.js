/**
 * ZAIAdapter.js — FUSIONARY (v1.0)
 * Primary LLM adapter. Uses z-ai-web-dev-sdk which provides access
 * to GLM-4.6, GLM-4.5V, and other frontier models hosted by Z.ai.
 *
 * GLM-4.6 is the recommended default for scientific reasoning tasks:
 *   - 200K-token context window
 *   - Strong reasoning across STEM benchmarks
 *   - Tool-use and JSON-mode support
 *
 * For embeddings, falls back to a deterministic hash embedding because
 * the gateway does not expose a native embed endpoint.
 */

import ZAI from 'z-ai-web-dev-sdk';
import { LLMAdapter } from './LLMAdapter.js';

const DIM = 384;

function hashEmbed(text) {
  const e = new Float64Array(DIM);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const slot = (i * 31 + code) % DIM;
    e[slot] += Math.sin(code * 0.01 + i * 0.1) * (1 + (code % 5));
  }
  let n = 0;
  for (const v of e) n += v * v;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < DIM; i++) e[i] /= n;
  return Array.from(e);
}

export class ZAIAdapter extends LLMAdapter {
  constructor(opts = {}) {
    super(opts);
    this.model = opts.model ?? 'glm-4.6';
    this._zai = null;
  }

  async _ensureClient() {
    if (!this._zai) {
      try {
        this._zai = await ZAI.create();
      } catch (err) {
        throw new Error(`Failed to initialise z-ai-web-dev-sdk: ${err.message}`);
      }
    }
    return this._zai;
  }

  _envelope(ok, extra = {}) {
    return { ok, timestamp: Date.now(), adapter: 'zai', model: this.model, ...extra };
  }

  async chat(prompt, systemPrompt) {
    try {
      const client = await this._ensureClient();
      const messages = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      messages.push({ role: 'user', content: prompt });

      const response = await client.chat.completions.create({
        model: this.model,
        messages,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
      });

      const choice = response.choices?.[0];
      const content = choice?.message?.content ?? '';
      return this._envelope(true, {
        content,
        usage: response.usage ?? null,
        finishReason: choice?.finish_reason ?? null,
      });
    } catch (err) {
      return this._envelope(false, { error: err.message ?? String(err), content: '' });
    }
  }

  async complete(prompt) {
    return this.chat(prompt);
  }

  async embed(text) {
    if (typeof text !== 'string' || text.length === 0) {
      return this._envelope(false, { error: 'embed() requires a non-empty string' });
    }
    return this._envelope(true, { embedding: hashEmbed(text) });
  }

  async classify(text, labels) {
    return super.classify(text, labels);
  }
}

export { hashEmbed };
