/**
 * StateSerializer.js — FUSIONARY (v1.0)
 * Saves/loads full agent state as versioned JSON files.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';

export class StateSerializer {
  constructor(opts = {}) {
    this.checkpointDir = opts.checkpointDir ?? './data/checkpoints';
    this.maxCheckpoints = opts.maxCheckpoints ?? 20;
  }

  async save(agent, label = 'checkpoint') {
    if (!existsSync(this.checkpointDir)) mkdirSync(this.checkpointDir, { recursive: true });
    const id = uuidv4();
    const timestamp = Date.now();
    const filename = `${timestamp}_${label.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
    const filepath = join(this.checkpointDir, filename);
    const state = {
      version: '1.0',
      id,
      label,
      timestamp,
      agentState: agent.serialize(),
    };
    writeFileSync(filepath, JSON.stringify(state, null, 2));
    this._prune();
    return { id, label, filepath };
  }

  async load(agent, labelOrId) {
    if (!existsSync(this.checkpointDir)) return null;
    const files = readdirSync(this.checkpointDir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();
    for (const f of files) {
      if (f.includes(labelOrId)) {
        const state = JSON.parse(readFileSync(join(this.checkpointDir, f), 'utf8'));
        agent.deserialize(state.agentState);
        return { label: state.label, timestamp: state.timestamp };
      }
    }
    return null;
  }

  list() {
    if (!existsSync(this.checkpointDir)) return [];
    return readdirSync(this.checkpointDir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse()
      .map(f => {
        try {
          const s = JSON.parse(readFileSync(join(this.checkpointDir, f), 'utf8'));
          return { file: f, label: s.label, timestamp: s.timestamp };
        } catch { return null; }
      })
      .filter(Boolean);
  }

  _prune() {
    const files = readdirSync(this.checkpointDir)
      .filter(f => f.endsWith('.json'))
      .sort();
    while (files.length > this.maxCheckpoints) {
      const oldest = files.shift();
      try { unlinkSync(join(this.checkpointDir, oldest)); } catch {}
    }
  }
}
