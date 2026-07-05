/**
 * MetricsCollector.js — FUSIONARY (v1.0)
 * Observability stack: counters, gauges, histograms, timers, time-series.
 *
 * FUSIONARY-specific KPIs:
 *   - documents_produced
 *   - hypotheses_generated
 *   - patents_drafted
 *   - feasibility_check_passes
 *   - llm_calls_by_adapter
 *   - average_quality
 *   - average_novelty
 *   - average_feasibility
 *   - average_patentability
 */

import { EventEmitter } from 'eventemitter3';

export class MetricsCollector extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
    this.timers = new Map();
    this.timeseries = new Map();
    this.enableConsole = opts.enableConsole ?? false;
    this._timerStarts = new Map();
    this.started = false;
  }

  start() {
    this.started = true;
    if (this.enableConsole) {
      this._consoleTimer = setInterval(() => this._dump(), 30_000);
    }
    this.emit('started');
  }

  stop() {
    if (this._consoleTimer) clearInterval(this._consoleTimer);
    this.started = false;
    this.emit('stopped');
  }

  incrementCounter(name, value = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
    this._pushTimeseries(name, value);
  }

  setGauge(name, value) {
    this.gauges.set(name, value);
    this._pushTimeseries(name, value);
  }

  observeHistogram(name, value) {
    if (!this.histograms.has(name)) this.histograms.set(name, []);
    const arr = this.histograms.get(name);
    arr.push(value);
    if (arr.length > 1000) arr.shift();
    this._pushTimeseries(name, value);
  }

  startTimer(name) {
    const id = `${name}_${Date.now()}_${Math.random()}`;
    this._timerStarts.set(id, Date.now());
    return id;
  }

  stopTimer(name, id) {
    const start = this._timerStarts.get(id);
    if (!start) return 0;
    const elapsed = Date.now() - start;
    if (!this.timers.has(name)) this.timers.set(name, []);
    const arr = this.timers.get(name);
    arr.push(elapsed);
    if (arr.length > 500) arr.shift();
    this._timerStarts.delete(id);
    this._pushTimeseries(name, elapsed);
    return elapsed;
  }

  _pushTimeseries(name, value) {
    if (!this.timeseries.has(name)) this.timeseries.set(name, []);
    const arr = this.timeseries.get(name);
    arr.push({ t: Date.now(), v: value });
    if (arr.length > 1440) arr.shift(); // keep 24h at 1-min resolution
  }

  getSummary() {
    const histogramStats = {};
    for (const [name, arr] of this.histograms) {
      if (arr.length === 0) continue;
      const sorted = [...arr].sort((a, b) => a - b);
      histogramStats[name] = {
        count: arr.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        mean: arr.reduce((s, v) => s + v, 0) / arr.length,
        p50: sorted[Math.floor(arr.length * 0.5)],
        p95: sorted[Math.floor(arr.length * 0.95)],
      };
    }
    const timerStats = {};
    for (const [name, arr] of this.timers) {
      if (arr.length === 0) continue;
      timerStats[name] = {
        count: arr.length,
        meanMs: arr.reduce((s, v) => s + v, 0) / arr.length,
        lastMs: arr[arr.length - 1],
      };
    }
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: histogramStats,
      timers: timerStats,
      timeseriesKeys: [...this.timeseries.keys()],
    };
  }

  resetAll() {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.timers.clear();
    this.timeseries.clear();
    this._timerStarts.clear();
    this.emit('reset');
  }

  _dump() {
    const s = this.getSummary();
    console.log('[Metrics]', JSON.stringify({
      counters: s.counters,
      gauges: s.gauges,
    }));
  }
}
