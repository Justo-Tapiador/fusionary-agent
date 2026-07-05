/**
 * example-plugin.js — FUSIONARY (v1.0)
 * Demonstrates the plugin hook system. Logs every patent drafted
 * and alerts when LLM token usage exceeds a budget.
 */

export const patentLoggerPlugin = {
  name: 'patent-logger',
  version: '1.0.0',
  hooks: {
    patentDrafted: (ctx) => {
      const p = ctx.patentDraft;
      console.log(`[patent-logger] Drafted: ${p.title} (${p.claims?.length ?? 0} claims)`);
    },
    documentArchived: (ctx) => {
      const m = ctx.manifest;
      console.log(`[patent-logger] Archived: ${m.category}/${m.topic}/${m.id}`);
    },
    hypothesisGenerated: (ctx) => {
      const h = ctx.hypothesis ?? ctx;
      console.log(`[patent-logger] Hypothesis: ${(h.statement ?? '').slice(0, 80)}...`);
    },
  },
};

export const budgetAlertPlugin = {
  name: 'budget-alert',
  version: '1.0.0',
  hooks: {
    afterStep: (ctx) => {
      // ctx contains cycle information; in a real plugin you would
      // inspect agent.metrics to compare token usage against budget.
      // Returning false would cancel the next step (not recommended).
    },
  },
};

export default patentLoggerPlugin;
