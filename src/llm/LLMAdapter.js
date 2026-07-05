/**
 * LLMAdapter.js — FUSIONARY (v1.0)
 * Abstract LLM adapter interface. All adapters must implement:
 *   chat(prompt, systemPrompt) -> { ok, content, usage, ... }
 *   complete(prompt)           -> { ok, content, usage, ... }
 *   embed(text)                -> { ok, embedding }
 *   classify(text, labels)     -> { ok, label, confidence }
 */

export class LLMAdapter {
  constructor(opts = {}) {
    this.model      = opts.model ?? 'default';
    this.temperature = opts.temperature ?? 0.7;
    this.maxTokens  = opts.maxTokens ?? 4096;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  async chat(_prompt, _systemPrompt) {
    throw new Error('chat() not implemented');
  }

  async complete(_prompt) {
    return this.chat(_prompt);
  }

  async embed(_text) {
    throw new Error('embed() not implemented');
  }

  async classify(text, labels) {
    const systemPrompt = [
      'You are a classification engine. Respond with EXACTLY ONE of the following labels,',
      'and nothing else.',
      'Labels: ' + labels.join(' | '),
    ].join('\n');
    const r = await this.chat(text, systemPrompt);
    if (!r.ok) return r;
    const raw = (r.content ?? '').trim().toLowerCase();
    const matched = labels.find(l => l.toLowerCase() === raw)
                 ?? labels.find(l => l.toLowerCase().includes(raw))
                 ?? null;
    return {
      ok: true,
      label: matched ?? r.content.trim(),
      confidence: matched ? 1.0 : 0.5,
      raw: r.content.trim(),
    };
  }

  metadata() {
    return {
      model: this.model,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      adapter: this.constructor.name,
    };
  }
}
