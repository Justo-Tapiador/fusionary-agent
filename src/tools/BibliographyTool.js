/**
 * BibliographyTool.js — FUSIONARY (v1.0)
 * Builds BibTeX files for archived documents.
 */

import { Tool } from './Tool.js';
import { v4 as uuidv4 } from 'uuid';

const ENTRY_TYPES = ['article', 'inproceedings', 'techreport', 'misc', 'online', 'patent'];

function escapeLatex(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}');
}

export class BibliographyTool extends Tool {
  constructor(opts = {}) {
    super(opts);
    this.id = 'bibliography';
    this.name = 'Bibliography Builder';
    this.description = 'Generates BibTeX entries from citation metadata.';
    this.schema = {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['add', 'compile'] },
        entries: { type: 'array' },
      },
    };
    this.entries = new Map();
  }

  async execute(args) {
    const op = args?.operation ?? 'add';
    if (op === 'add') {
      const list = Array.isArray(args?.entries) ? args.entries : [];
      const added = [];
      for (const e of list) {
        const id = e.key ?? uuidv4().slice(0, 8);
        this.entries.set(id, e);
        added.push(id);
      }
      return { ok: true, added, total: this.entries.size };
    }
    if (op === 'compile') {
      return { ok: true, bibtex: this.compile() };
    }
    return { ok: false, error: `Unknown operation: ${op}` };
  }

  compile() {
    const lines = [];
    for (const [key, e] of this.entries) {
      const type = ENTRY_TYPES.includes(e.type) ? e.type : 'misc';
      lines.push(`@${type}{${key},`);
      if (e.title)   lines.push(`  title   = {${escapeLatex(e.title)}},`);
      if (e.author)  lines.push(`  author  = {${escapeLatex(e.author)}},`);
      if (e.year)    lines.push(`  year    = {${e.year}},`);
      if (e.journal) lines.push(`  journal = {${escapeLatex(e.journal)}},`);
      if (e.volume)  lines.push(`  volume  = {${e.volume}},`);
      if (e.pages)   lines.push(`  pages   = {${e.pages}},`);
      if (e.doi)     lines.push(`  doi     = {${e.doi}},`);
      if (e.url)     lines.push(`  url     = {${e.url}},`);
      if (e.note)    lines.push(`  note    = {${escapeLatex(e.note)}},`);
      lines.push('}');
      lines.push('');
    }
    return lines.join('\n');
  }
}
