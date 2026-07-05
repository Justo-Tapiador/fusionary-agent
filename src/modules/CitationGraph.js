/**
 * CitationGraph.js — FUSIONARY (v1.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Tracks citation relationships between archived documents, external
 * papers (arXiv, DOI), and KG concepts. Used by:
 *   - PatentDraftAssistant to verify novelty against prior art
 *   - HypothesisGenerator to identify orphan concepts (no citations)
 *   - The web UI to render a citation network visualisation
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export class CitationGraph extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.storagePath = opts.storagePath ?? join(process.cwd(), 'data', 'citation_graph.json');
    this.papers = new Map();   // id -> { id, title, doi, arxiv, year, authors, type }
    this.citations = new Map(); // id -> { id, from, to, type: 'cite'|'extends'|'contradicts'|'patent_blocks' }
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    if (existsSync(this.storagePath)) {
      try {
        const raw = readFileSync(this.storagePath, 'utf8');
        const data = JSON.parse(raw);
        for (const p of data.papers ?? []) this.papers.set(p.id, p);
        for (const c of data.citations ?? []) this.citations.set(c.id, c);
      } catch (err) {
        this.emit('error', { stage: 'load', error: err.message });
      }
    }
    this.initialized = true;
  }

  addPaper(opts = {}) {
    const id = opts.id ?? `paper_${uuidv4().slice(0, 8)}`;
    const paper = {
      id,
      title: opts.title ?? id,
      doi: opts.doi ?? null,
      arxiv: opts.arxiv ?? null,
      year: opts.year ?? new Date().getFullYear(),
      authors: Array.isArray(opts.authors) ? opts.authors : [],
      type: opts.type ?? 'paper',  // paper | patent | fusionary_doc | book
      url: opts.url ?? null,
    };
    this.papers.set(id, paper);
    this.emit('paperAdded', paper);
    return paper;
  }

  cite(opts = {}) {
    const id = opts.id ?? uuidv4();
    if (!this.papers.has(opts.from) || !this.papers.has(opts.to)) {
      throw new Error('Citation endpoints must exist');
    }
    const c = {
      id,
      from: opts.from,
      to: opts.to,
      type: ['cite', 'extends', 'contradicts', 'patent_blocks', 'enables'].includes(opts.type) ? opts.type : 'cite',
      context: opts.context ?? '',
      createdAt: Date.now(),
    };
    this.citations.set(id, c);
    this.emit('citationAdded', c);
    return c;
  }

  /** Prior art blocking search — used by PatentDraftAssistant. */
  priorArt(claimText) {
    const results = [];
    const text = (claimText ?? '').toLowerCase();
    for (const paper of this.papers.values()) {
      const title = (paper.title ?? '').toLowerCase();
      // Very simple keyword match; LLM can refine later
      const keywords = title.split(/\s+/).filter(w => w.length > 4).slice(0, 5);
      const hits = keywords.filter(k => text.includes(k));
      if (hits.length >= 2) {
        results.push({ paper, hits, score: hits.length / keywords.length });
      }
    }
    return results.sort((a, b) => b.score - a.score);
  }

  /** Orphan concepts — papers with no inbound citations (under-discovered). */
  orphans() {
    const cited = new Set();
    for (const c of this.citations.values()) cited.add(c.to);
    return [...this.papers.values()].filter(p => !cited.has(p.id));
  }

  async persist() {
    const dir = dirname(this.storagePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const data = {
      version: '1.0',
      updatedAt: Date.now(),
      papers: [...this.papers.values()],
      citations: [...this.citations.values()],
    };
    writeFileSync(this.storagePath, JSON.stringify(data, null, 2));
    this.emit('persisted', { path: this.storagePath });
  }

  stats() {
    return {
      papers: this.papers.size,
      citations: this.citations.size,
      orphans: this.orphans().length,
    };
  }
}
