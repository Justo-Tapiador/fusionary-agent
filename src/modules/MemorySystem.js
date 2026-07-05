/**
 * MemorySystem.js — FUSIONARY (v1.0)
 * Three-tier persistent memory specialised for scientific research.
 *
 *   Episodic:  Records of past research cycles (hypothesis → design → patent)
 *   Semantic:  Facts extracted from the KG and external literature
 *   Working:   Short-term buffer for the current research cycle
 *
 * Embeddings: simple deterministic hash-based (384-dim) when no LLM is
 * configured; if an LLM adapter with embed() is supplied, it is used.
 */

import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';

function hashEmbed(text, dim = 384) {
  const e = new Float64Array(dim);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const slot = (i * 31 + code) % dim;
    e[slot] += Math.sin(code * 0.01 + i * 0.1) * (1 + (code % 5));
  }
  let n = 0;
  for (const v of e) n += v * v;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < dim; i++) e[i] /= n;
  return Array.from(e);
}

function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i];
  return s;
}

export class MemorySystem extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.storageDir = opts.storageDir ?? join(process.cwd(), 'data', 'memory');
    this.llm = opts.llm ?? null;
    this.episodic = [];
    this.semantic = new Map();
    this.working = new Map();
    this.maxWorking = opts.maxWorking ?? 50;
    this.ttlMs = opts.ttlMs ?? 30 * 60 * 1000;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    if (!existsSync(this.storageDir)) mkdirSync(this.storageDir, { recursive: true });
    await this._loadEpisodic();
    await this._loadSemantic();
    // Prune expired working memory on init
    this._pruneWorking();
    this.initialized = true;
    this.emit('ready');
  }

  // ── Episodic ───────────────────────────────────────────────────────────────

  async store(topic, payload, metadata = {}) {
    const id = uuidv4();
    const text = `${topic} ${JSON.stringify(payload)}`;
    const embedding = this.llm ? (await this._safeEmbed(text)) : hashEmbed(text);
    const record = {
      id,
      topic,
      payload,
      embedding,
      metadata,
      timestamp: Date.now(),
    };
    this.episodic.push(record);
    if (this.episodic.length > 1000) this.episodic = this.episodic.slice(-1000);
    await this._persistEpisodicRecord(record);
    this.emit('episodicStored', { id, topic });
    return record;
  }

  async recall(query, opts = {}) {
    const limit = opts.limit ?? 5;
    const minSim = opts.minSimilarity ?? 0.3;
    const text = `${query} ${JSON.stringify(opts.context ?? {})}`;
    const qe = this.llm ? (await this._safeEmbed(text)) : hashEmbed(text);

    const scored = this.episodic.map(rec => ({
      rec,
      score: cosine(qe, rec.embedding ?? []),
    }));
    return scored
      .filter(s => s.score >= minSim)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => ({ ...s.rec, similarity: s.score }));
  }

  // ── Semantic ───────────────────────────────────────────────────────────────

  async storeSemantic(key, value, confidence = 0.5) {
    const text = `${key} ${JSON.stringify(value)}`;
    const embedding = this.llm ? (await this._safeEmbed(text)) : hashEmbed(text);
    const record = {
      key,
      value,
      confidence,
      embedding,
      updatedAt: Date.now(),
    };
    this.semantic.set(key, record);
    await this._persistSemanticRecord(record);
    this.emit('semanticStored', { key });
    return record;
  }

  retrieveSemantic(key) {
    return this.semantic.get(key);
  }

  // ── Working memory ─────────────────────────────────────────────────────────

  setWorking(key, value, ttl = this.ttlMs) {
    this.working.set(key, {
      value,
      expires: ttl > 0 ? Date.now() + ttl : 0,
    });
    if (this.working.size > this.maxWorking) {
      const oldest = this.working.keys().next().value;
      this.working.delete(oldest);
    }
    this.emit('workingSet', { key });
  }

  getWorking(key) {
    const entry = this.working.get(key);
    if (!entry) return null;
    if (entry.expires && entry.expires < Date.now()) {
      this.working.delete(key);
      return null;
    }
    return entry.value;
  }

  _pruneWorking() {
    const now = Date.now();
    for (const [k, v] of this.working) {
      if (v.expires && v.expires < now) this.working.delete(k);
    }
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  async _safeEmbed(text) {
    try {
      const r = await this.llm.embed(text);
      if (r?.ok && Array.isArray(r.embedding)) return r.embedding;
    } catch (err) {
      this.emit('warning', { stage: 'embed', error: err.message });
    }
    return hashEmbed(text);
  }

  async _persistEpisodicRecord(rec) {
    const file = join(this.storageDir, 'episodic', `${rec.id}.json`);
    if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(rec, null, 2));
  }

  async _loadEpisodic() {
    const dir = join(this.storageDir, 'episodic');
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      try {
        const rec = JSON.parse(readFileSync(join(dir, entry), 'utf8'));
        this.episodic.push(rec);
      } catch (err) {
        this.emit('warning', { stage: 'loadEpisodic', file: entry, error: err.message });
      }
    }
  }

  async _persistSemanticRecord(rec) {
    const file = join(this.storageDir, 'semantic', `${rec.key.replace(/[^a-zA-Z0-9_]/g, '_')}.json`);
    if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(rec, null, 2));
  }

  async _loadSemantic() {
    const dir = join(this.storageDir, 'semantic');
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      try {
        const rec = JSON.parse(readFileSync(join(dir, entry), 'utf8'));
        this.semantic.set(rec.key, rec);
      } catch (err) {
        this.emit('warning', { stage: 'loadSemantic', file: entry, error: err.message });
      }
    }
  }

  stats() {
    return {
      episodic: this.episodic.length,
      semantic: this.semantic.size,
      working: this.working.size,
    };
  }
}
