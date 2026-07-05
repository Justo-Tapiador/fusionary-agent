/**
 * FUSIONARY v1.0 — Dashboard client
 * Real-time WebSocket feed + REST API + tab navigation
 */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const state = {
  ws: null,
  wsConnected: false,
  startedAt: Date.now(),
  feedEntries: 0,
};

// ─── Tab navigation ──────────────────────────────────────────────────────────
$$('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.tab').forEach((b) => b.classList.remove('active'));
    $$('.panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    $(`#panel-${tab}`).classList.add('active');
    if (tab === 'archive') loadArchive();
    if (tab === 'patents') loadPatents();
    if (tab === 'kg')      loadKG();
    if (tab === 'metrics') loadMetrics();
  });
});

// ─── WebSocket ───────────────────────────────────────────────────────────────
function connectWS() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${window.location.host}/ws`;
  state.ws = new WebSocket(url);

  state.ws.onopen = () => {
    state.wsConnected = true;
    $('#chip-ws').textContent = 'WS: connected';
    $('#chip-ws').classList.add('chip-ok');
    addFeedEntry('system', 'WebSocket connected');
  };

  state.ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleMessage(msg);
  };

  state.ws.onclose = () => {
    state.wsConnected = false;
    $('#chip-ws').textContent = 'WS: disconnected';
    $('#chip-ws').classList.remove('chip-ok');
    addFeedEntry('system', 'WebSocket disconnected — retrying in 3s');
    setTimeout(connectWS, 3000);
  };

  state.ws.onerror = () => state.ws.close();
}

function handleMessage(msg) {
  const { event, data } = msg;
  switch (event) {
    case 'connected':
      updateStatus(data.agentStatus);
      addFeedEntry('system', `Agent online — id ${data.agentStatus?.id?.slice(0, 8)}`);
      break;
    case 'status:update':
      updateStatus(data);
      break;
    case 'cycle:start':
      $('#chip-cycle').textContent = `Cycle: ${data.count}`;
      addFeedEntry('cycle', `Cycle ${data.count} started (id ${data.cycleId?.slice(0, 16)})`);
      break;
    case 'plan:interpreted':
      addFeedEntry('plan', `Topic: ${data.topic ?? 'autonomous'} | Target: ${data.targetMetric ?? '—'} ${data.targetValue ?? ''}`);
      break;
    case 'annPsi:forward':
      addFeedEntry('ann', `ANN-Psi forward pass — ${data.layerOutputs?.length ?? 0} layers`);
      break;
    case 'hypothesis:generated':
      addFeedEntry('hypothesis', truncate(data.statement ?? '(no statement)', 120));
      break;
    case 'patent:drafted':
      addFeedEntry('patent', `Drafted: ${truncate(data.title ?? '', 80)} (${data.claims?.length ?? 0} claims)`);
      break;
    case 'document:archived':
      addFeedEntry('archive', `${data.manifest.category}/${data.manifest.topic}/${data.manifest.id}`);
      break;
    case 'cycle:complete':
      addFeedEntry('cycle', `Cycle complete — hypothesis ${data.hypothesis?.id?.slice(0, 12)}`);
      break;
    case 'cycle:error':
      addFeedEntry('error', data.error ?? 'unknown');
      break;
    case 'safety:blocked':
      addFeedEntry('safety', `Blocked: ${data.reason ?? 'unknown'}`);
      break;
    case 'cycles:exhausted':
      addFeedEntry('system', `All ${data.count} cycles exhausted.`);
      break;
    case 'metrics:update':
    case 'metrics:snapshot':
      if ($('#panel-metrics').classList.contains('active')) renderMetrics(data);
      break;
  }
}

// ─── UI helpers ──────────────────────────────────────────────────────────────
function updateStatus(s) {
  if (!s) return;
  $('#chip-cycle').textContent = `Cycle: ${s.currentCycle ?? 0}/${s.maxCycles ?? 0}`;
  $('#chip-mode').textContent = `Mode: ${s.autonomousMode ? 'autonomous' : 'manual'}`;
  $('#chip-llm').textContent  = `LLM: ${typeof s.llm === 'string' ? s.llm : 'active'}`;
  $('#chip-docs').textContent = `Docs: ${s.archive?.total ?? 0}`;
}

function addFeedEntry(tag, message) {
  const feed = $('#feed');
  const div = document.createElement('div');
  div.className = 'feed-entry';
  const time = new Date().toLocaleTimeString('en-GB');
  div.innerHTML = `
    <span class="feed-time">${time}</span>
    <span class="feed-tag ${tag}">${tag.toUpperCase()}</span>
    <span class="feed-msg"></span>
  `;
  div.querySelector('.feed-msg').textContent = message;
  feed.appendChild(div);
  state.feedEntries++;
  if (state.feedEntries > 200) {
    feed.removeChild(feed.firstChild);
    state.feedEntries--;
  }
  feed.scrollTop = feed.scrollHeight;
}

function truncate(s, n) {
  if (typeof s !== 'string') return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ─── Archive ─────────────────────────────────────────────────────────────────
async function loadArchive() {
  try {
    const r = await fetch('/api/archive');
    const docs = await r.json();
    const list = $('#archive-list');
    list.innerHTML = '';
    if (docs.length === 0) {
      list.innerHTML = '<p class="muted">No documents yet. The agent is bootstrapping…</p>';
      return;
    }
    for (const d of docs) {
      const card = document.createElement('div');
      card.className = 'archive-card';
      const date = new Date(d.createdAt).toISOString().slice(0, 10);
      const tags = (d.tags ?? []).map((t) => `<span class="tag ${t}">${t}</span>`).join('');
      card.innerHTML = `
        <div class="date">${date}</div>
        <div>
          <div class="title">${escapeHTML(d.title)}</div>
          <div class="meta">${d.category} / ${d.topic} / ${d.id}</div>
        </div>
        <div class="tags">${tags}</div>
      `;
      list.appendChild(card);
    }
  } catch (err) {
    $('#archive-list').innerHTML = `<p class="muted">Error: ${err.message}</p>`;
  }
}

$('#archive-search')?.addEventListener('input', async (e) => {
  const q = e.target.value.toLowerCase().trim();
  $$('.archive-card').forEach((card) => {
    const text = card.textContent.toLowerCase();
    card.style.display = q && !text.includes(q) ? 'none' : '';
  });
});

// ─── Patents ─────────────────────────────────────────────────────────────────
async function loadPatents() {
  try {
    const r = await fetch('/api/patents');
    const patents = await r.json();
    const list = $('#patents-list');
    list.innerHTML = '';
    if (patents.length === 0) {
      list.innerHTML = '<p class="muted">No patent-eligible documents yet.</p>';
      return;
    }
    for (const p of patents) {
      const card = document.createElement('div');
      card.className = 'patent-card';
      const date = new Date(p.createdAt).toISOString().slice(0, 10);
      const claims = (p.claims ?? []).map((c) => `<li>${escapeHTML(c)}</li>`).join('');
      card.innerHTML = `
        <h3>${escapeHTML(p.title)}</h3>
        <div class="meta">${date} — ${p.topic} — ${p.path}</div>
        <ol>${claims}</ol>
      `;
      list.appendChild(card);
    }
  } catch (err) {
    $('#patents-list').innerHTML = `<p class="muted">Error: ${err.message}</p>`;
  }
}

$('#btn-refresh-patents')?.addEventListener('click', loadPatents);

// ─── Knowledge Graph ─────────────────────────────────────────────────────────
async function loadKG() {
  try {
    const [r1, r2] = await Promise.all([
      fetch('/api/kg').then((r) => r.text()),
      fetch('/api/kg/stats').then((r) => r.json()),
    ]);
    $('#kg-mermaid').textContent = r1;
    $('#kg-stats').textContent = `${r2.nodes} nodes, ${r2.edges} edges`;
  } catch (err) {
    $('#kg-mermaid').textContent = `Error: ${err.message}`;
  }
}

// ─── Metrics ─────────────────────────────────────────────────────────────────
async function loadMetrics() {
  try {
    const r = await fetch('/api/metrics');
    const m = await r.json();
    renderMetrics(m);
  } catch (err) {
    $('#metrics-grid').innerHTML = `<p class="muted">Error: ${err.message}</p>`;
  }
}

function renderMetrics(m) {
  const grid = $('#metrics-grid');
  const cards = [];
  if (m.counters) {
    for (const [k, v] of Object.entries(m.counters)) {
      cards.push(`
        <div class="metric-card">
          <div class="label">${k.replace(/_/g, ' ')}</div>
          <div class="value">${v}</div>
        </div>
      `);
    }
  }
  if (m.gauges) {
    for (const [k, v] of Object.entries(m.gauges)) {
      cards.push(`
        <div class="metric-card">
          <div class="label">${k.replace(/_/g, ' ')}</div>
          <div class="value">${typeof v === 'number' ? v.toFixed(2) : v}</div>
        </div>
      `);
    }
  }
  if (m.histograms) {
    for (const [k, v] of Object.entries(m.histograms)) {
      cards.push(`
        <div class="metric-card">
          <div class="label">${k.replace(/_/g, ' ')} (hist)</div>
          <div class="value">${v.mean?.toFixed(3) ?? '—'}</div>
          <div class="sub">p50 ${v.p50?.toFixed(3) ?? '—'} · p95 ${v.p95?.toFixed(3) ?? '—'} · n=${v.count}</div>
        </div>
      `);
    }
  }
  grid.innerHTML = cards.join('') || '<p class="muted">No metrics yet.</p>';
}

// ─── Owner guidance ──────────────────────────────────────────────────────────
$('#guide-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const directive = $('#guide-input').value.trim();
  if (!directive) return;
  const safety = $('#safety-select').value;
  try {
    await fetch('/api/safety/level', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: safety }),
    });
    const r = await fetch('/api/guide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directive }),
    });
    const data = await r.json();
    addFeedEntry('system', `Directive accepted: "${directive.slice(0, 80)}"`);
    $('#guide-input').value = '';
  } catch (err) {
    addFeedEntry('error', `Guide failed: ${err.message}`);
  }
});

$$('.btn-quick').forEach((btn) => {
  btn.addEventListener('click', () => {
    $('#guide-input').value = btn.dataset.directive;
    $('#guide-input').focus();
  });
});

// ─── Clear feed ──────────────────────────────────────────────────────────────
$('#btn-clear-feed')?.addEventListener('click', () => {
  $('#feed').innerHTML = '';
  state.feedEntries = 0;
});

// ─── Utilities ───────────────────────────────────────────────────────────────
function escapeHTML(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Uptime ──────────────────────────────────────────────────────────────────
setInterval(() => {
  const s = Math.floor((Date.now() - state.startedAt) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  $('#footer-uptime').textContent = `Uptime: ${h}h ${m}m ${sec}s`;
}, 1000);

// ─── Boot ────────────────────────────────────────────────────────────────────
connectWS();
addFeedEntry('system', 'FUSIONARY dashboard booting — connecting to agent…');

// Initial status fetch
fetch('/api/status').then((r) => r.json()).then(updateStatus).catch(() => {});
