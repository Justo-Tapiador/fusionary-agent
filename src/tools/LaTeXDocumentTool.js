/**
 * LaTeXDocumentTool.js — FUSIONARY (v1.0)
 * Compiles a TeX source string into a PDF using the local `pdflatex`
 * toolchain if available; otherwise writes only the .tex file and
 * emits a warning. Always returns the absolute paths of the produced
 * artifacts.
 *
 * Inputs:
 *   { source: <tex string>, outputPath: <dir>, filename: <stem> }
 * Outputs:
 *   { texPath, pdfPath?, log?, ok, error? }
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { Tool } from './Tool.js';

export class LaTeXDocumentTool extends Tool {
  constructor(opts = {}) {
    super(opts);
    this.id = 'latex_document';
    this.name = 'LaTeX Document Compiler';
    this.description = 'Compiles a TeX source string into a PDF artifact.';
    this.schema = {
      type: 'object',
      required: ['source', 'outputPath'],
      properties: {
        source: { type: 'string' },
        outputPath: { type: 'string' },
        filename: { type: 'string' },
        attempts: { type: 'number' },
      },
    };
    this.pdflatexPath = opts.pdflatexPath ?? 'pdflatex';
    this._available = null;
  }

  isAvailable() {
    if (this._available !== null) return this._available;
    try {
      const r = spawnSync(this.pdflatexPath, ['--version'], { encoding: 'utf8' });
      this._available = r.status === 0;
    } catch {
      this._available = false;
    }
    return this._available;
  }

  async execute(args) {
    const { source, outputPath, filename = 'main', attempts = 2 } = args;
    if (!source) return { ok: false, error: 'Missing "source"' };
    if (!outputPath) return { ok: false, error: 'Missing "outputPath"' };

    if (!existsSync(outputPath)) mkdirSync(outputPath, { recursive: true });
    const texPath = join(outputPath, `${filename}.tex`);
    writeFileSync(texPath, source);

    if (!this.isAvailable()) {
      return {
        ok: true,
        texPath,
        pdfPath: null,
        warning: 'pdflatex not available; only .tex was written.',
      };
    }

    let lastLog = '';
    for (let i = 0; i < attempts; i++) {
      try {
        const result = spawnSync(
          this.pdflatexPath,
          ['-interaction=nonstopmode', '-halt-on-error', '-output-directory', outputPath, texPath],
          { encoding: 'utf8', timeout: 60_000 }
        );
        lastLog = result.stdout ?? '';
        if (result.status === 0) {
          const pdfPath = join(outputPath, `${filename}.pdf`);
          if (existsSync(pdfPath)) {
            return { ok: true, texPath, pdfPath, log: lastLog };
          }
        }
      } catch (err) {
        return { ok: false, texPath, error: err.message, log: lastLog };
      }
    }
    return {
      ok: false,
      texPath,
      error: 'pdflatex failed after multiple attempts',
      log: lastLog,
    };
  }
}
