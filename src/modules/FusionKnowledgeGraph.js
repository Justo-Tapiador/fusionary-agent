/**
 * FusionKnowledgeGraph.js — FUSIONARY (v1.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Domain knowledge graph for fusion research. Tracks:
 *   - Concepts (e.g. "tokamak", "Lawson criterion", "REBCO magnet")
 *   - Their relationships (depends-on, enables, contradicts, improves, ...)
 *   - Confidence scores and citation links to archived documents
 *   - Resource-feasibility annotations (current / near-term / far-term)
 *
 * Used by:
 *   - HypothesisGenerator (to find under-explored regions)
 *   - ResourceFeasibilityChecker (to anchor claims to known tech)
 *   - PatentDraftAssistant (to verify novelty against prior art in the graph)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const RELATION_TYPES = Object.freeze([
  'depends_on',
  'enables',
  'contradicts',
  'improves',
  'measured_by',
  'fuel_for',
  'breeds',
  'confines',
  'extracts_heat_from',
  'shields_from',
  'patent_prior_art_for',
]);

const FEASIBILITY_TIERS = Object.freeze([
  'current',         // built today at scale
  'near_term',       // 1-5 years with current investments
  'mid_term',        // 5-15 years, requires new infrastructure
  'long_term',       // 15-30 years
  'speculative',     // >30 years or unknown physics
]);

export class FusionKnowledgeGraph extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.storagePath = opts.storagePath ?? join(process.cwd(), 'data', 'knowledge_graph.json');
    this.nodes = new Map();  // id -> node
    this.edges = new Map();  // id -> edge
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    if (existsSync(this.storagePath)) {
      try {
        const raw = readFileSync(this.storagePath, 'utf8');
        const data = JSON.parse(raw);
        for (const n of data.nodes ?? []) this.nodes.set(n.id, n);
        for (const e of data.edges ?? []) this.edges.set(e.id, e);
        this.emit('loaded', { nodes: this.nodes.size, edges: this.edges.size });
      } catch (err) {
        this.emit('error', { stage: 'load', error: err.message });
      }
    } else {
      this._seedBaselineKnowledge();
      await this.persist();
    }
    this.initialized = true;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  addNode(opts = {}) {
    const id = opts.id ?? uuidv4();
    const node = {
      id,
      label: opts.label ?? id,
      kind: opts.kind ?? 'concept',  // concept, technology, material, parameter, paper, patent, person, institution
      description: opts.description ?? '',
      feasibility: FEASIBILITY_TIERS.includes(opts.feasibility) ? opts.feasibility : 'speculative',
      tags: Array.isArray(opts.tags) ? opts.tags : [],
      citations: Array.isArray(opts.citations) ? opts.citations : [],
      confidence: typeof opts.confidence === 'number' ? opts.confidence : 0.5,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.nodes.set(id, node);
    this.emit('nodeAdded', node);
    return node;
  }

  addEdge(opts = {}) {
    const id = opts.id ?? uuidv4();
    if (!this.nodes.has(opts.from) || !this.nodes.has(opts.to)) {
      throw new Error(`Edge endpoints must exist: from=${opts.from} to=${opts.to}`);
    }
    const edge = {
      id,
      from: opts.from,
      to: opts.to,
      type: RELATION_TYPES.includes(opts.type) ? opts.type : 'depends_on',
      weight: typeof opts.weight === 'number' ? opts.weight : 0.5,
      evidence: Array.isArray(opts.evidence) ? opts.evidence : [],
      createdAt: Date.now(),
    };
    this.edges.set(id, edge);
    this.emit('edgeAdded', edge);
    return edge;
  }

  /** Find concepts that have low connectivity — under-explored regions. */
  findUnderExplored(limit = 10) {
    const degrees = new Map();
    for (const node of this.nodes.values()) {
      degrees.set(node.id, 0);
    }
    for (const edge of this.edges.values()) {
      degrees.set(edge.from, (degrees.get(edge.from) ?? 0) + 1);
      degrees.set(edge.to, (degrees.get(edge.to) ?? 0) + 1);
    }
    const sorted = [...degrees.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(0, limit)
      .map(([id, deg]) => ({ node: this.nodes.get(id), degree: deg }));
    return sorted;
  }

  /** Two-hop neighbours of a node — used for hypothesis generation. */
  neighbourhood(nodeId, maxDepth = 2) {
    if (!this.nodes.has(nodeId)) return [];
    const visited = new Set([nodeId]);
    const frontier = [nodeId];
    const result = [];
    for (let depth = 0; depth < maxDepth; depth++) {
      const nextFrontier = [];
      for (const id of frontier) {
        for (const edge of this.edges.values()) {
          let neighbourId = null;
          if (edge.from === id && !visited.has(edge.to)) neighbourId = edge.to;
          else if (edge.to === id && !visited.has(edge.from)) neighbourId = edge.from;
          if (neighbourId) {
            visited.add(neighbourId);
            nextFrontier.push(neighbourId);
            result.push({ node: this.nodes.get(neighbourId), depth: depth + 1, viaEdge: edge });
          }
        }
      }
      frontier.length = 0;
      frontier.push(...nextFrontier);
    }
    return result;
  }

  /** Quick text search over node labels and descriptions. */
  search(query) {
    const q = (query ?? '').toLowerCase().trim();
    if (!q) return [];
    const results = [];
    for (const node of this.nodes.values()) {
      const haystack = `${node.label} ${node.description} ${node.tags.join(' ')}`.toLowerCase();
      if (haystack.includes(q)) results.push(node);
    }
    return results;
  }

  /** Build a Mermaid graph string for visualisation. */
  toMermaid(maxNodes = 50) {
    const lines = ['graph TD'];
    const nodesToShow = [...this.nodes.values()].slice(0, maxNodes);
    const ids = new Set(nodesToShow.map(n => n.id));
    for (const node of nodesToShow) {
      const safe = node.id.replace(/[^a-zA-Z0-9_]/g, '_');
      lines.push(`  ${safe}["${node.label}"]`);
    }
    const edgeArrows = {
      depends_on: '-->',
      enables: '==>',
      contradicts: '--x',
      improves: '-->',
      measured_by: '-->',
      fuel_for: '-->',
      breeds: '-->',
      confines: '-->',
      extracts_heat_from: '-->',
      shields_from: '-->',
      patent_prior_art_for: '-.->',
    };
    for (const edge of this.edges.values()) {
      if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
      const a = edge.from.replace(/[^a-zA-Z0-9_]/g, '_');
      const b = edge.to.replace(/[^a-zA-Z0-9_]/g, '_');
      const arrow = edgeArrows[edge.type] ?? '-->';
      lines.push(`  ${a} ${arrow}|${edge.type}| ${b}`);
    }
    return lines.join('\n');
  }

  async persist() {
    const dir = dirname(this.storagePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const data = {
      version: '1.0',
      updatedAt: Date.now(),
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
    };
    writeFileSync(this.storagePath, JSON.stringify(data, null, 2));
    this.emit('persisted', { path: this.storagePath });
  }

  stats() {
    return {
      nodes: this.nodes.size,
      edges: this.edges.size,
      relationTypes: RELATION_TYPES.length,
      feasibilityTiers: FEASIBILITY_TIERS.length,
    };
  }

  // ── Seed baseline knowledge — current state of fusion research ────────────

  _seedBaselineKnowledge() {
    // Concepts
    const tokamak = this.addNode({
      id: 'concept_tokamak',
      label: 'Tokamak',
      kind: 'technology',
      description: 'Toroidal magnetic confinement device with axisymmetric field and plasma current.',
      feasibility: 'near_term',
      tags: ['magnetic_confinement', 'D-T', 'ITER'],
      confidence: 0.95,
    });
    const stellarator = this.addNode({
      id: 'concept_stellarator',
      label: 'Stellarator',
      kind: 'technology',
      description: 'Toroidal magnetic confinement with fully 3D fields; no plasma current needed.',
      feasibility: 'mid_term',
      tags: ['magnetic_confinement', 'Wendelstein 7-X', 'steady_state'],
      confidence: 0.85,
    });
    const icf = this.addNode({
      id: 'concept_icf',
      label: 'Inertial Confinement Fusion (ICF)',
      kind: 'technology',
      description: 'Laser- or ion-driven compression of a fuel capsule to achieve ignition.',
      feasibility: 'mid_term',
      tags: ['NIF', 'inertial', 'laser'],
      confidence: 0.75,
    });
    const mif = this.addNode({
      id: 'concept_mif',
      label: 'Magneto-Inertial Fusion (MIF)',
      kind: 'technology',
      description: 'Pulsed-power compression of magnetised plasma;介于 ICF 与 MCF 之间.',
      feasibility: 'mid_term',
      tags: ['pulsed', 'Z-pinch', 'MagLIF'],
      confidence: 0.65,
    });
    const pb11 = this.addNode({
      id: 'concept_pb11',
      label: 'p-B11 Aneutronic Fusion',
      kind: 'technology',
      description: 'Proton-boron-11 reaction yielding 3 alphas and ~0.2% neutrons; aneutronic ideal.',
      feasibility: 'long_term',
      tags: ['aneutronic', 'direct_conversion'],
      confidence: 0.45,
    });
    const lawson = this.addNode({
      id: 'concept_lawson',
      label: 'Lawson Criterion',
      kind: 'parameter',
      description: 'n·τ·T product required for net fusion power. D-T: ~3e21 keV·s/m³; p-B11: ~5e23.',
      feasibility: 'current',
      tags: ['ignition', 'threshold'],
      confidence: 0.99,
    });
    const reco = this.addNode({
      id: 'concept_reco_magnet',
      label: 'REBCO High-Tc Superconducting Magnet',
      kind: 'technology',
      description: 'Rare-earth barium copper oxide tapes enabling >20 T fields at 20 K.',
      feasibility: 'near_term',
      tags: ['HTS', 'SPARC', '20T'],
      confidence: 0.9,
    });
    const llc = this.addNode({
      id: 'concept_liquid_lithium',
      label: 'Liquid Lithium First Wall',
      kind: 'technology',
      description: 'Flowing lithium wall that absorbs neutrons, breeds tritium, and self-heals.',
      feasibility: 'mid_term',
      tags: ['PFC', 'tritium_breeding', 'self_healing'],
      confidence: 0.7,
    });
    const breeder = this.addNode({
      id: 'concept_tritium_breeder',
      label: 'Tritium Breeding Blanket',
      kind: 'technology',
      description: 'Lithium-ceramic or liquid-metal blanket producing tritium via (n,α) reactions.',
      feasibility: 'near_term',
      tags: ['fuel_cycle', 'TBR', 'breeding'],
      confidence: 0.85,
    });
    const directConvert = this.addNode({
      id: 'concept_direct_conversion',
      label: 'Direct Energy Conversion',
      kind: 'technology',
      description: 'Inverse-cyclotron converter turning charged fusion products into electricity at >80%.',
      feasibility: 'long_term',
      tags: ['aneutronic', 'efficiency'],
      confidence: 0.4,
    });

    // Relationships
    this.addEdge({ from: 'concept_tokamak', to: 'concept_reco_magnet', type: 'depends_on', weight: 0.9 });
    this.addEdge({ from: 'concept_tokamak', to: 'concept_tritium_breeder', type: 'depends_on', weight: 0.8 });
    this.addEdge({ from: 'concept_tokamak', to: 'concept_lawson', type: 'measured_by', weight: 1.0 });
    this.addEdge({ from: 'concept_stellarator', to: 'concept_reco_magnet', type: 'depends_on', weight: 0.7 });
    this.addEdge({ from: 'concept_stellarator', to: 'concept_lawson', type: 'measured_by', weight: 1.0 });
    this.addEdge({ from: 'concept_icf', to: 'concept_lawson', type: 'measured_by', weight: 1.0 });
    this.addEdge({ from: 'concept_mif', to: 'concept_lawson', type: 'measured_by', weight: 0.9 });
    this.addEdge({ from: 'concept_mif', to: 'concept_icf', type: 'improves', weight: 0.6 });
    this.addEdge({ from: 'concept_pb11', to: 'concept_lawson', type: 'measured_by', weight: 1.0 });
    this.addEdge({ from: 'concept_pb11', to: 'concept_direct_conversion', type: 'enables', weight: 0.9 });
    this.addEdge({ from: 'concept_pb11', to: 'concept_tokamak', type: 'contradicts', weight: 0.4,
      evidence: ['p-B11 requires T~300 keV, far above tokamak regime (~10-20 keV)'] });
    this.addEdge({ from: 'concept_liquid_lithium', to: 'concept_tritium_breeder', type: 'breeds', weight: 0.8 });
    this.addEdge({ from: 'concept_liquid_lithium', to: 'concept_tokamak', type: 'improves', weight: 0.7 });
    this.addEdge({ from: 'concept_reco_magnet', to: 'concept_tokamak', type: 'enables', weight: 0.9 });
    this.addEdge({ from: 'concept_reco_magnet', to: 'concept_stellarator', type: 'enables', weight: 0.8 });

    this.emit('seeded', this.stats());
  }
}

export { RELATION_TYPES, FEASIBILITY_TIERS };
