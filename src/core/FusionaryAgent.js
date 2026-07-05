/**
 * FusionaryAgent.js — FUSIONARY (v1.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Main orchestrator. Extends the predator-jungle-agent v2.0 architecture
 * with a domain-specialised scientific research loop.
 *
 * Key behaviour:
 *   - On launch, immediately begins autonomous research (does NOT wait
 *     for an owner directive — this is the AJN "addiction" property).
 *   - Each research cycle:
 *       1. Interpret owner directive (or pick under-explored topic autonomously)
 *       2. Generate hypothesis via HypothesisGenerator
 *       3. Assess feasibility via ResourceFeasibilityChecker
 *       4. If feasible: draft design and patent application
 *       5. Archive all artifacts under /research/<category>/<topic>/<id>/
 *       6. Update KG and CitationGraph
 *       7. Push progress events to WebSocket subscribers
 *   - Owner can guide the agent at any time via the web UI or CLI:
 *       `node scripts/cli.js guide "Focus on TBR > 1.2 with HCPB blanket"`
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';

import { ANNPsi, FUSION_STIMULUS_CLASSES } from './ANNPsi.js';
import { HierarchicalCommandInterpreter } from '../modules/HierarchicalCommandInterpreter.js';
import {
  TokenEnergyArbitrator,
  PraxicStreamExecutor,
} from '../modules/TokenEnergyArbitrator.js';
import { CascadeMonitor } from '../modules/CascadeMonitor.js';
import { MemorySystem } from '../modules/MemorySystem.js';
import { SafetyGuardrails } from '../modules/SafetyGuardrails.js';
import { MetricsCollector } from '../modules/MetricsCollector.js';
import { PluginManager } from '../modules/PluginManager.js';
import { FusionKnowledgeGraph } from '../modules/FusionKnowledgeGraph.js';
import { CitationGraph } from '../modules/CitationGraph.js';
import { HypothesisGenerator } from '../modules/HypothesisGenerator.js';
import { ResourceFeasibilityChecker } from '../modules/ResourceFeasibilityChecker.js';
import { DocumentArchivist } from '../modules/DocumentArchivist.js';
import { PatentDraftAssistant } from '../modules/PatentDraftAssistant.js';

import { ToolRegistry } from '../tools/ToolRegistry.js';
import { FileSystemTool } from '../tools/FileSystemTool.js';
import { LaTeXDocumentTool } from '../tools/LaTeXDocumentTool.js';
import { PlasmaPhysicsTool } from '../tools/PlasmaPhysicsTool.js';
import { WebSearchTool } from '../tools/WebSearchTool.js';
import { BibliographyTool } from '../tools/BibliographyTool.js';

const DEFAULT_MAX_CYCLES = 50;
const CYCLE_INTERVAL_MS = 5_000; // 5 seconds between cycles when idle

export class FusionaryAgent extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.id             = opts.id ?? uuidv4();
    this.maxCycles      = opts.maxCycles ?? DEFAULT_MAX_CYCLES;
    this.cycleIntervalMs = opts.cycleIntervalMs ?? CYCLE_INTERVAL_MS;
    this.autonomousMode = opts.autonomousMode ?? true;
    this.ownerDirective = null;

    // Core backbone (14-layer ANN-Psi with AJN + Transformer)
    this.annPsi = new ANNPsi({
      dModel: opts.dModel ?? 256,
      nHeads: opts.nHeads ?? 8,
      dFF: opts.dFF ?? 1024,
      maxSteps: opts.maxSteps ?? 200,
    });

    // LLM (single adapter or router)
    this.llm = opts.llm ?? null;

    // Modules
    this.memory            = new MemorySystem({ llm: this.llm, ...opts.memory });
    this.safety            = new SafetyGuardrails({ safetyLevel: opts.safetyLevel ?? 'standard' });
    this.metrics           = new MetricsCollector({ enableConsole: opts.metricsConsole ?? false });
    this.plugins           = new PluginManager();
    this.kg                = new FusionKnowledgeGraph({});
    this.citations         = new CitationGraph({});
    this.archivist         = new DocumentArchivist({ rootDir: opts.researchDir ?? './research' });
    this.feasibility       = new ResourceFeasibilityChecker({ kg: this.kg });
    this.hypothesisGen     = new HypothesisGenerator({
      kg: this.kg, llm: this.llm, feasibilityChecker: this.feasibility,
    });
    this.patentAssistant   = new PatentDraftAssistant({
      llm: this.llm, feasibilityChecker: this.feasibility,
    });
    this.hci               = new HierarchicalCommandInterpreter({
      llm: this.llm, kg: this.kg,
    });
    this.tea               = new TokenEnergyArbitrator({});
    this.pse               = new PraxicStreamExecutor({ maxRetries: 3 });
    this.cascade           = new CascadeMonitor({});

    // Tool registry
    this.tools = new ToolRegistry();
    this.tools.registerMany([
      new FileSystemTool({ sandbox: opts.researchDir ?? './research' }),
      new LaTeXDocumentTool(),
      new PlasmaPhysicsTool(),
      new WebSearchTool(),
      new BibliographyTool(),
    ]);
    this.pse.registry = this.tools;

    // State
    this.currentCycle = 0;
    this.isRunning = false;
    this._timer = null;
    this.history = [];
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async init() {
    await this.memory.init();
    await this.kg.init();
    await this.citations.init();
    this.archivist.ensureLayout();
    this.metrics.start();
    this.emit('ready', { id: this.id, kg: this.kg.stats() });

    // AUTONOMOUS ACTIVATION: do NOT wait for an owner directive.
    if (this.autonomousMode) {
      this._scheduleNextCycle(0);
    }
  }

  async shutdown() {
    this.emit('shutdown:start');
    this.isRunning = false;
    if (this._timer) clearTimeout(this._timer);
    await this.kg.persist();
    await this.citations.persist();
    this.metrics.stop();
    this.emit('shutdown:complete');
  }

  // ── Owner guidance ─────────────────────────────────────────────────────────

  async guide(directive) {
    this.ownerDirective = directive;
    this.emit('owner:directive', { directive });
    // Force-start a new cycle immediately
    if (!this.isRunning) this._scheduleNextCycle(0);
    return { accepted: true, directive };
  }

  // ── Research cycle ─────────────────────────────────────────────────────────

  _scheduleNextCycle(delay = this.cycleIntervalMs) {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this._runCycle().catch(err => {
      this.emit('cycle:error', { error: err.message });
      this._scheduleNextCycle();
    }), delay);
  }

  async _runCycle() {
    if (this.currentCycle >= this.maxCycles) {
      this.emit('cycles:exhausted', { count: this.currentCycle });
      return;
    }
    this.isRunning = true;
    this.currentCycle++;
    const cycleId = `cycle_${this.currentCycle}_${Date.now()}`;
    this.emit('cycle:start', { cycleId, count: this.currentCycle });

    try {
      // 1. Safety check before any work
      const safetyCheck = this.safety.check({
        type: 'research_cycle',
        payload: { directive: this.ownerDirective },
      });
      if (!safetyCheck.allowed) {
        this.emit('safety:blocked', safetyCheck);
        this.isRunning = false;
        this._scheduleNextCycle();
        return;
      }

      // 2. Interpret owner directive (or pick autonomously)
      const plan = await this.hci.interpret(this.ownerDirective);
      this.emit('plan:interpreted', plan);

      // 3. Forward pass through ANN-Psi
      const stimulus = {
        intensity: 0.6 + Math.random() * 0.4,
        topic: plan.topic,
        parameters: plan.parameters,
      };
      const annResult = this.annPsi.forward(stimulus);
      this.emit('annPsi:forward', annResult);

      // 4. Generate hypothesis
      const hypotheses = await this.hypothesisGen.generate({
        count: 1,
        seedTopic: plan.topic,
        ownerDirective: this.ownerDirective,
      });
      const hypothesis = hypotheses[0];
      this.emit('hypothesis:generated', hypothesis);
      this.metrics.incrementCounter('hypotheses_generated');

      // 5. Archive the hypothesis document
      const hypRecord = this.archivist.archive({
        category: 'hypotheses',
        title: hypothesis.statement?.slice(0, 80) ?? `Hypothesis ${hypothesis.id}`,
        topic: plan.topic ?? 'general',
        markdownSource: this._hypothesisToMarkdown(hypothesis),
        tags: ['intermediate_result', ...(hypothesis.feasibility?.tier ? [`custom:${hypothesis.feasibility.tier}`] : [])],
        references: hypothesis.supportingConcepts ?? [],
        patent: {
          eligible: hypothesis.patentabilityHint === 'YES',
          claims: hypothesis.candidatePatentClaims ?? [],
        },
        extra: { hypothesis },
      });
      this.emit('document:archived', hypRecord);
      this.metrics.incrementCounter('documents_produced');

      // 6. If feasibility is OK, draft a patent application
      if (hypothesis.feasibility?.tier && hypothesis.feasibility.tier !== 'speculative') {
        const patentDraft = await this.patentAssistant.draft({
          hypothesis,
          parameters: plan.parameters,
        });
        this.emit('patent:drafted', patentDraft);
        this.metrics.incrementCounter('patents_drafted');

        const patentRecord = this.archivist.archive({
          category: 'patents',
          title: patentDraft.title,
          topic: plan.topic ?? 'general',
          markdownSource: this._patentToMarkdown(patentDraft),
          latexSource: this._patentToLatex(patentDraft),
          tags: hypothesis.feasibility?.tier === 'near_term' || hypothesis.feasibility?.tier === 'current'
            ? ['patent_ready', 'final_result']
            : ['patent_pending', 'intermediate_result'],
          references: hypothesis.supportingConcepts ?? [],
          patent: {
            eligible: true,
            claims: patentDraft.claims?.map(c => c.text) ?? [],
          },
          extra: { patentDraft },
        });
        this.emit('document:archived', patentRecord);
        this.metrics.incrementCounter('documents_produced');
      }

      // 7. Memory + metrics update
      await this.memory.store(`cycle_${this.currentCycle}`, {
        hypothesis: hypothesis.id,
        plan,
        feasibility: hypothesis.feasibility,
      });
      this.metrics.observeHistogram('average_quality',
        hypothesis.rewardComponents?.quality ?? 0.5);
      this.metrics.observeHistogram('average_novelty',
        hypothesis.rewardComponents?.novelty ?? 0.5);
      this.metrics.observeHistogram('average_feasibility',
        hypothesis.feasibility?.confidence ?? 0.5);
      this.metrics.observeHistogram('average_patentability',
        hypothesis.patentabilityHint === 'YES' ? 1.0
        : hypothesis.patentabilityHint === 'MAYBE' ? 0.5 : 0.0);

      // 8. Plugin hooks
      await this.plugins.runHook('afterStep', { cycleId, hypothesis });

      // 9. Rebuild indices periodically
      if (this.currentCycle % 5 === 0) {
        this.archivist.rebuildIndices();
      }

      this.history.push({ cycleId, plan, hypothesis, timestamp: Date.now() });
      this.emit('cycle:complete', { cycleId, hypothesis });
    } catch (err) {
      this.emit('cycle:error', { cycleId, error: err.message });
      this.cascade.record({ type: 'error', error: err.message });
    }

    this.isRunning = false;
    this._scheduleNextCycle();
  }

  // ── Document renderers ─────────────────────────────────────────────────────

  _hypothesisToMarkdown(h) {
    return [
      `# ${h.statement?.slice(0, 100) ?? 'Hypothesis'}`,
      '',
      `**ID:** ${h.id}`,
      `**Source:** ${h.source ?? 'unknown'}`,
      `**Created:** ${new Date(h.createdAt ?? Date.now()).toISOString()}`,
      '',
      '## Statement',
      '',
      h.statement ?? '',
      '',
      '## Rationale',
      '',
      h.rationale ?? '',
      '',
      '## Supporting Concepts',
      '',
      ...(h.supportingConcepts ?? []).map(c => `- ${c}`),
      '',
      '## Predicted Impact',
      '',
      h.predictedImpact
        ? `Metric: **${h.predictedImpact.metric}** — ${h.predictedImpact.direction} by ${h.predictedImpact.magnitude}`
        : '_not specified_',
      '',
      '## Feasibility',
      '',
      h.feasibility
        ? `Tier: **${h.feasibility.tier}** (confidence ${h.feasibility.confidence ?? 'n/a'})`
        : '_not yet assessed_',
      '',
      '## Proposed Experiments',
      '',
      ...(h.proposedExperiments ?? []).map(e => `- ${e}`),
      '',
      '## Candidate Patent Claims',
      '',
      ...(h.candidatePatentClaims ?? []).map((c, i) => `${i + 1}. ${c}`),
      '',
    ].join('\n');
  }

  _patentToMarkdown(p) {
    return [
      `# ${p.title}`,
      '',
      `**Patent Draft ID:** ${p.id}`,
      `**Source:** ${p.source ?? 'unknown'}`,
      `**Created:** ${new Date(p.createdAt ?? Date.now()).toISOString()}`,
      '',
      '## Abstract',
      '',
      p.abstract ?? '',
      '',
      '## Field of the Invention',
      '',
      p.field ?? '',
      '',
      '## Background',
      '',
      p.background ?? '',
      '',
      '## Summary',
      '',
      p.summary ?? '',
      '',
      '## Brief Description of Drawings',
      '',
      ...(p.drawings ?? []).map(d => `- ${d}`),
      '',
      '## Detailed Description',
      '',
      '```',
      p.detailedDescription ?? '',
      '```',
      '',
      '## Claims',
      '',
      ...(p.claims ?? []).map(c => `**Claim ${c.number}** (${c.kind}): ${c.text}`),
      '',
    ].join('\n');
  }

  _patentToLatex(p) {
    const claims = (p.claims ?? [])
      .map(c => `\\item[${c.kind}] ${c.text.replace(/\n/g, ' ')}`)
      .join('\n');
    return [
      '\\documentclass[11pt]{article}',
      '\\usepackage[utf8]{inputenc}',
      '\\usepackage{hyperref}',
      '\\usepackage{amsmath}',
      '\\title{' + (p.title ?? 'Untitled') + '}',
      '\\author{FUSIONARY Autonomous Patent Drafter}',
      '\\date{\\today}',
      '\\begin{document}',
      '\\maketitle',
      '',
      '\\begin{abstract}',
      p.abstract ?? '',
      '\\end{abstract}',
      '',
      '\\section{Field of the Invention}',
      p.field ?? '',
      '',
      '\\section{Background}',
      p.background ?? '',
      '',
      '\\section{Summary}',
      p.summary ?? '',
      '',
      '\\section{Brief Description of Drawings}',
      '\\begin{itemize}',
      ...(p.drawings ?? []).map(d => `  \\item ${d}`),
      '\\end{itemize}',
      '',
      '\\section{Detailed Description}',
      '\\begin{verbatim}',
      p.detailedDescription ?? '',
      '\\end{verbatim}',
      '',
      '\\section{Claims}',
      '\\begin{enumerate}',
      claims,
      '\\end{enumerate}',
      '',
      '\\end{document}',
    ].join('\n');
  }

  // ── Status & serialisation ─────────────────────────────────────────────────

  status() {
    return {
      id: this.id,
      currentCycle: this.currentCycle,
      maxCycles: this.maxCycles,
      isRunning: this.isRunning,
      autonomousMode: this.autonomousMode,
      ownerDirective: this.ownerDirective,
      annPsi: this.annPsi.status(),
      memory: this.memory.stats(),
      kg: this.kg.stats(),
      citations: this.citations.stats(),
      archive: this.archivist.stats(),
      cascade: this.cascade.status(),
      tools: this.tools.list().map(t => t.id),
      metrics: this.metrics.getSummary(),
      llm: this.llm?.metadata?.() ?? this.llm?.constructor?.name ?? 'none',
    };
  }

  serialize() {
    return {
      id: this.id,
      currentCycle: this.currentCycle,
      maxCycles: this.maxCycles,
      autonomousMode: this.autonomousMode,
      ownerDirective: this.ownerDirective,
      annPsi: this.annPsi.serialize(),
      history: this.history.slice(-100),
    };
  }

  deserialize(state) {
    this.id = state.id ?? this.id;
    this.currentCycle = state.currentCycle ?? 0;
    this.maxCycles = state.maxCycles ?? this.maxCycles;
    this.autonomousMode = state.autonomousMode ?? this.autonomousMode;
    this.ownerDirective = state.ownerDirective ?? null;
    if (state.annPsi) this.annPsi.deserialize(state.annPsi);
    if (state.history) this.history = state.history;
  }
}

export { FUSION_STIMULUS_CLASSES };
