/**
 * ToolRegistry.js — FUSIONARY (v1.0)
 * Central registry for tools with schema validation.
 */

import { EventEmitter } from 'eventemitter3';

export class ToolRegistry extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.tools = new Map();
  }

  register(tool) {
    if (!tool?.id) throw new Error('Tool must have an id');
    if (this.tools.has(tool.id)) {
      throw new Error(`Tool already registered: ${tool.id}`);
    }
    this.tools.set(tool.id, tool);
    this.emit('registered', { id: tool.id, name: tool.name });
  }

  registerMany(tools) {
    for (const t of tools) this.register(t);
  }

  get(id) {
    return this.tools.get(id);
  }

  list() {
    return [...this.tools.values()].map(t => t.metadata());
  }

  async execute(id, args) {
    const tool = this.tools.get(id);
    if (!tool) throw new Error(`Unknown tool: ${id}`);
    return tool.execute(args);
  }
}
