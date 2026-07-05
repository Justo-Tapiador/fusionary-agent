/**
 * PluginManager.js — FUSIONARY (v1.0)
 * Hook-based plugin system with priority ordering and cancellation.
 */

import { EventEmitter } from 'eventemitter3';

const HOOKS = Object.freeze([
  'beforeStep',
  'afterStep',
  'beforeEmit',
  'afterEmit',
  'taskComplete',
  'directiveReceived',
  'extinction',
  'trainingEpoch',
  'hypothesisGenerated',
  'patentDrafted',
  'documentArchived',
  'feasibilityChecked',
  'ownerDirective',
  'shutdown',
]);

export class PluginManager extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.plugins = new Map();   // name -> { plugin, priority }
    this.hooks = new Map();     // hookName -> sorted array of { name, fn, priority }
    for (const h of HOOKS) this.hooks.set(h, []);
  }

  register(plugin, priority = 100) {
    if (!plugin?.name) throw new Error('Plugin must have a name');
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin already registered: ${plugin.name}`);
    }
    this.plugins.set(plugin.name, { plugin, priority });
    if (plugin.hooks) {
      for (const [hook, fn] of Object.entries(plugin.hooks)) {
        if (!this.hooks.has(hook)) {
          this.emit('warning', { plugin: plugin.name, hook, reason: 'unknown_hook' });
          continue;
        }
        this.hooks.get(hook).push({ name: plugin.name, fn, priority });
        this.hooks.get(hook).sort((a, b) => a.priority - b.priority);
      }
    }
    this.emit('registered', { name: plugin.name, priority });
  }

  unregister(name) {
    if (!this.plugins.has(name)) return false;
    this.plugins.delete(name);
    for (const arr of this.hooks.values()) {
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i].name === name) arr.splice(i, 1);
      }
    }
    this.emit('unregistered', { name });
    return true;
  }

  async runHook(hookName, context = {}) {
    if (!this.hooks.has(hookName)) return context;
    let ctx = { ...context };
    for (const entry of this.hooks.get(hookName)) {
      try {
        const result = await entry.fn(ctx);
        if (result === false) {
          this.emit('cancelled', { hook: hookName, plugin: entry.name });
          return null; // cancel propagation
        }
        if (result && typeof result === 'object') ctx = { ...ctx, ...result };
      } catch (err) {
        this.emit('pluginError', { hook: hookName, plugin: entry.name, error: err.message });
      }
    }
    return ctx;
  }

  list() {
    return [...this.plugins.values()].map(p => ({
      name: p.plugin.name,
      version: p.plugin.version ?? '0.0.0',
      priority: p.priority,
      hooks: Object.keys(p.plugin.hooks ?? {}),
    }));
  }
}

export { HOOKS };
