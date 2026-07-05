/**
 * Tool.js — FUSIONARY (v1.0)
 * Abstract base class for all tools.
 */

import { EventEmitter } from 'eventemitter3';

export class Tool extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.id = opts.id ?? 'tool';
    this.name = opts.name ?? 'Tool';
    this.description = opts.description ?? '';
    this.schema = opts.schema ?? { type: 'object' };
  }

  /** Subclasses override. */
  async execute(_args) {
    throw new Error('Not implemented');
  }

  metadata() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      schema: this.schema,
    };
  }
}
