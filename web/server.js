#!/usr/bin/env node
/**
 * FUSIONARY Web Dashboard Server — v1.0
 * Express + WebSocket real-time monitoring and owner-guidance interface.
 *
 * Routes:
 *   GET  /                    Dashboard (single-page app)
 *   GET  /api/status          Agent status snapshot
 *   GET  /api/archive         List archived documents
 *   GET  /api/archive/<id>    Fetch a specific document
 *   GET  /api/patents         Patent-eligible documents
 *   GET  /api/kg              Knowledge graph (Mermaid text)
 *   GET  /api/metrics         Metrics summary
 *   POST /api/guide           Send an owner directive
 *   WS   /ws                  Real-time event stream
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

import { createFusionary } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const PORT      = parseInt(process.env.FUSIONARY_PORT ?? '3000', 10);
const HOST      = process.env.FUSIONARY_HOST ?? '0.0.0.0';
const STATIC_DIR = join(__dirname, 'public');
const WS_PATH   = '/ws';

// ─── Agent ──────────────────────────────────────────────────────────────────
const agent = await createFusionary({
  researchDir: process.env.FUSIONARY_RESEARCH_DIR ?? './research',
  maxCycles: parseInt(process.env.FUSIONARY_MAX_CYCLES ?? '500', 10),
  safetyLevel: process.env.FUSIONARY_SAFETY ?? 'standard',
});

// ─── WebSocket registry ─────────────────────────────────────────────────────
const wsClients = new Map();

function broadcast(event, data) {
  const payload = JSON.stringify({ event, data, timestamp: Date.now() });
  for (const [, c] of wsClients) {
    if (c.ws.readyState === 1) {
      try { c.ws.send(payload); } catch {}
    }
  }
}

const FORWARD_EVENTS = [
  'cycle:start', 'cycle:complete', 'cycle:error',
  'hypothesis:generated', 'patent:drafted', 'document:archived',
  'plan:interpreted', 'annPsi:forward',
  'safety:blocked', 'safety:warning',
  'cascade:warning', 'cascade:critical',
  'memory:recall', 'memory:store',
  'owner:directive',
  'cycles:exhausted',
  'shutdown:start', 'shutdown:complete',
  'ready',
];
for (const e of FORWARD_EVENTS) {
  agent.on(e, (data) => broadcast(e, data));
}

// ─── Express app ────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(STATIC_DIR));

app.get('/api/status', (_req, res) => res.json(agent.status()));

app.get('/api/archive', (_req, res) => {
  res.json(agent.archivist.list().map(r => ({
    id: r.manifest.id,
    title: r.manifest.title,
    category: r.manifest.category,
    topic: r.manifest.topic,
    tags: r.manifest.tags,
    createdAt: r.manifest.createdAt,
    patentEligible: r.manifest.patent?.eligible ?? false,
    path: `${r.manifest.category}/${r.manifest.topic}/${r.manifest.id}`,
  })));
});

app.get('/api/archive/:category/:topic/:id', (req, res) => {
  const { category, topic, id } = req.params;
  const list = agent.archivist.list(category);
  const r = list.find(x => x.manifest.id === id && x.manifest.topic === topic);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(r.manifest);
});

app.get('/api/patents', (_req, res) => {
  res.json(agent.archivist.patentQueue().map(r => ({
    id: r.manifest.id,
    title: r.manifest.title,
    topic: r.manifest.topic,
    claims: r.manifest.patent?.claims ?? [],
    createdAt: r.manifest.createdAt,
    path: `${r.manifest.category}/${r.manifest.topic}/${r.manifest.id}`,
  })));
});

app.get('/api/kg', (_req, res) => {
  res.type('text/plain').send(agent.kg.toMermaid(80));
});

app.get('/api/kg/stats', (_req, res) => res.json(agent.kg.stats()));

app.get('/api/metrics', (_req, res) => res.json(agent.metrics.getSummary()));

app.get('/api/citations/stats', (_req, res) => res.json(agent.citations.stats()));

app.post('/api/guide', async (req, res) => {
  const { directive } = req.body ?? {};
  if (!directive) return res.status(400).json({ error: 'Missing "directive"' });
  const r = await agent.guide(directive);
  res.json(r);
});

app.post('/api/safety/level', (req, res) => {
  const { level } = req.body ?? {};
  try {
    agent.safety.setLevel(level);
    res.json({ ok: true, level });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/shutdown', async (_req, res) => {
  res.json({ ok: true });
  await agent.shutdown();
});

// ─── HTTP + WS server ───────────────────────────────────────────────────────
const server = createServer(app);
const wss = new WebSocketServer({ server, path: WS_PATH });

wss.on('connection', (ws) => {
  const clientId = randomUUID();
  wsClients.set(clientId, { ws, subscriptions: new Set(['*']) });
  console.log(`[WS] Client connected: ${clientId} (total: ${wsClients.size})`);

  ws.send(JSON.stringify({
    event: 'connected',
    data: { clientId, agentStatus: agent.status(), serverTime: Date.now() },
    timestamp: Date.now(),
  }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch {
      ws.send(JSON.stringify({ event: 'error', data: { message: 'Invalid JSON' } }));
      return;
    }
    handleMessage(clientId, msg);
  });

  ws.on('close', () => {
    wsClients.delete(clientId);
    console.log(`[WS] Client disconnected: ${clientId} (total: ${wsClients.size})`);
  });
});

async function handleMessage(clientId, msg) {
  const client = wsClients.get(clientId);
  if (!client) return;
  const { type, id, payload } = msg;
  try {
    switch (type) {
      case 'guide': {
        const r = await agent.guide(payload.directive);
        client.ws.send(JSON.stringify({
          event: 'guide:accepted', data: r, requestId: id, timestamp: Date.now(),
        }));
        break;
      }
      case 'status': {
        client.ws.send(JSON.stringify({
          event: 'status:update', data: agent.status(),
          requestId: id, timestamp: Date.now(),
        }));
        break;
      }
      case 'metrics': {
        client.ws.send(JSON.stringify({
          event: 'metrics:snapshot', data: agent.metrics.getSummary(),
          requestId: id, timestamp: Date.now(),
        }));
        break;
      }
      case 'archive:list': {
        client.ws.send(JSON.stringify({
          event: 'archive:list', data: agent.archivist.list(),
          requestId: id, timestamp: Date.now(),
        }));
        break;
      }
      case 'patents:list': {
        client.ws.send(JSON.stringify({
          event: 'patents:list', data: agent.archivist.patentQueue(),
          requestId: id, timestamp: Date.now(),
        }));
        break;
      }
      default:
        client.ws.send(JSON.stringify({
          event: 'error', data: { message: `Unknown type: ${type}` },
          requestId: id, timestamp: Date.now(),
        }));
    }
  } catch (err) {
    client.ws.send(JSON.stringify({
      event: 'error', data: { message: err.message, type },
      requestId: id, timestamp: Date.now(),
    }));
  }
}

// Periodic status push
setInterval(() => {
  if (wsClients.size > 0) broadcast('status:update', agent.status());
}, 2000);

setInterval(() => {
  if (wsClients.size > 0) broadcast('metrics:update', agent.metrics.getSummary());
}, 5000);

// Graceful shutdown
async function gracefulShutdown(signal) {
  console.log(`\n[Server] ${signal} received, shutting down...`);
  await agent.shutdown();
  for (const [, c] of wsClients) {
    try { c.ws.close(); } catch {}
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000);
}
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

server.listen(PORT, HOST, () => {
  console.log(`
  ╔════════════════════════════════════════════════════════════════════╗
  ║              FUSIONARY  v1.0  —  Web Dashboard Online              ║
  ╠════════════════════════════════════════════════════════════════════╣
  ║                                                                    ║
  ║   Dashboard :  http://${HOST}:${PORT}                               ║
  ║   WebSocket :  ws://${HOST}:${PORT}${WS_PATH}                        ║
  ║   REST API  :  http://${HOST}:${PORT}/api/*                          ║
  ║                                                                    ║
  ║   Mission   :  Practical, safe, short-to-mid-term fusion energy.   ║
  ║   Mode      :  Autonomous (AJN addiction active)                   ║
  ║                                                                    ║
  ╚════════════════════════════════════════════════════════════════════╝
  `);
});

export { app, server, wss, agent };
