/**
 * FileSystemTool.js — FUSIONARY (v1.0)
 * Real file I/O tool with sandbox directory enforcement.
 */

import { Tool } from './Tool.js';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync,
  unlinkSync, readdirSync, statSync, copyFileSync, renameSync,
} from 'node:fs';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';

const SANDBOX_DEFAULT = join(process.cwd(), 'research');

export class FileSystemTool extends Tool {
  constructor(opts = {}) {
    super(opts);
    this.id = 'filesystem';
    this.name = 'File System Tool';
    this.description = 'Sandboxed file I/O: read, write, append, delete, list, mkdir, copy, move.';
    this.sandbox = opts.sandbox ?? SANDBOX_DEFAULT;
    this.schema = {
      type: 'object',
      required: ['operation', 'path'],
      properties: {
        operation: { type: 'string', enum: ['read', 'write', 'append', 'delete', 'list', 'stat', 'mkdir', 'copy', 'move'] },
        path: { type: 'string' },
        content: { type: 'string' },
        dest: { type: 'string' },
      },
    };
  }

  _resolve(path) {
    const abs = isAbsolute(path) ? path : join(this.sandbox, path);
    const rel = relative(this.sandbox, abs);
    if (rel.startsWith('..')) {
      throw new Error(`Path escapes sandbox: ${path}`);
    }
    return abs;
  }

  async execute(args) {
    try {
      const op = args?.operation;
      const p = this._resolve(args?.path ?? '');
      switch (op) {
        case 'read':
          if (!existsSync(p)) return { ok: false, error: 'Not found' };
          return { ok: true, content: readFileSync(p, 'utf8') };
        case 'write':
          mkdirSync(dirname(p), { recursive: true });
          writeFileSync(p, args?.content ?? '');
          return { ok: true, path: p };
        case 'append':
          mkdirSync(dirname(p), { recursive: true });
          appendFileSync(p, args?.content ?? '');
          return { ok: true, path: p };
        case 'delete':
          if (existsSync(p)) { unlinkSync(p); return { ok: true }; }
          return { ok: false, error: 'Not found' };
        case 'list':
          if (!existsSync(p)) return { ok: false, error: 'Not found' };
          return { ok: true, entries: readdirSync(p) };
        case 'stat':
          if (!existsSync(p)) return { ok: false, error: 'Not found' };
          const s = statSync(p);
          return { ok: true, stat: { size: s.size, mtime: s.mtime, isDir: s.isDirectory() } };
        case 'mkdir':
          mkdirSync(p, { recursive: true });
          return { ok: true, path: p };
        case 'copy':
          if (!existsSync(p)) return { ok: false, error: 'Source not found' };
          const dst = this._resolve(args?.dest ?? '');
          mkdirSync(dirname(dst), { recursive: true });
          copyFileSync(p, dst);
          return { ok: true, from: p, to: dst };
        case 'move':
          if (!existsSync(p)) return { ok: false, error: 'Source not found' };
          const d = this._resolve(args?.dest ?? '');
          mkdirSync(dirname(d), { recursive: true });
          renameSync(p, d);
          return { ok: true, from: p, to: d };
        default:
          return { ok: false, error: `Unknown operation: ${op}` };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}
