/**
 * WebSearchTool.js — FUSIONARY (v1.0)
 * Web search via z-ai-web-dev-sdk. Falls back to a deterministic
 * "no results" stub when offline so the agent can continue operating.
 */

import { Tool } from './Tool.js';
import ZAI from 'z-ai-web-dev-sdk';

export class WebSearchTool extends Tool {
  constructor(opts = {}) {
    super(opts);
    this.id = 'web_search';
    this.name = 'Web Search Tool';
    this.description = 'Searches the web for current fusion research literature and news.';
    this.schema = {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        maxResults: { type: 'number' },
      },
    };
    this._zai = null;
  }

  async _client() {
    if (!this._zai) this._zai = await ZAI.create();
    return this._zai;
  }

  async execute(args) {
    const query = args?.query;
    if (!query) return { ok: false, error: 'Missing "query"' };
    try {
      const client = await this._client();
      const results = await client.functions.invoke('web_search', {
        query,
        num: args?.maxResults ?? 8,
      });
      return { ok: true, results };
    } catch (err) {
      return {
        ok: true,
        results: [],
        warning: `Web search unavailable: ${err.message}. Continuing offline.`,
      };
    }
  }
}
