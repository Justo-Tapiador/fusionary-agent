/**
 * HypothesisGenerator.js — FUSIONARY (v1.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates scientific hypotheses by combining concepts from the
 * FusionKnowledgeGraph with under-explored regions and current
 * resource-feasibility gaps.
 *
 * Uses an LLM adapter for natural-language hypothesis synthesis, but
 * can also operate deterministically (template-based) when no LLM is
 * configured.
 *
 * Output: structured hypothesis record with:
 *   - statement
 *   - rationale
 *   - supporting concepts (KG node IDs)
 *   - predicted impact on Q-factor / TBR / LCOE
 *   - feasibility tier
 *   - patentability hint
 *   - proposed experiments
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';

const HYPOTHESIS_TEMPLATES = [
  {
    pattern: ['magnetic_confinement', 'high_Tc_magnet'],
    template: 'Increasing the on-axis magnetic field from {B_old} to {B_new} via {magnet} yields a {gain}-fold increase in fusion power density, reducing the reactor radius needed for net energy by a factor of {radius_reduction}.',
  },
  {
    pattern: ['tritium_breeding', 'liquid_metal'],
    template: 'A flowing {liquid_metal} first wall with recycling loop achieves a Tritium Breeding Ratio (TBR) of {tbr_target} without the need for a separate solid breeder blanket, simplifying maintenance and improving availability to {availability}.',
  },
  {
    pattern: ['aneutronic', 'direct_conversion'],
    template: 'A {concept} reactor coupled to an inverse-cyclotron direct converter achieves a wall-plug efficiency of {efficiency} while producing <{neutron_threshold} neutrons per fusion reaction, enabling urban-sited deployment.',
  },
  {
    pattern: ['pulsed', 'magneto_inertial'],
    template: 'A pulsed {driver} compressing a pre-magnetised {target} liner to {rho_R} g/cm² reaches ignition with {driver_energy} MJ per shot at a repetition rate of {rep_rate} Hz, yielding an average gain Q = {Q}.',
  },
];

export class HypothesisGenerator extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.kg = opts.kg ?? null;
    this.llm = opts.llm ?? null;
    this.feasibilityChecker = opts.feasibilityChecker ?? null;
  }

  /**
   * Generate one or more hypotheses.
   * @param {object} opts
   * @param {number} [opts.count=1]   – how many to generate
   * @param {string} [opts.seedTopic] – optional anchor topic (KG node ID)
   * @param {string} [opts.ownerDirective] – human guidance text
   */
  async generate(opts = {}) {
    const count = opts.count ?? 1;
    const results = [];
    for (let i = 0; i < count; i++) {
      const hyp = await this._generateOne(opts);
      results.push(hyp);
      this.emit('hypothesis', hyp);
    }
    return results;
  }

  async _generateOne(opts) {
    const id = `hyp_${uuidv4().slice(0, 8)}`;
    const seedTopic = opts.seedTopic ?? this._pickSeedTopic();
    const neighbourhood = this.kg ? this.kg.neighbourhood(seedTopic, 2) : [];
    const underExplored = this.kg ? this.kg.findUnderExplored(5) : [];

    let hypothesis;
    if (this.llm) {
      hypothesis = await this._llmGenerate({
        id, seedTopic, neighbourhood, underExplored,
        ownerDirective: opts.ownerDirective,
      });
    } else {
      hypothesis = this._templateGenerate({
        id, seedTopic, neighbourhood, underExplored,
        ownerDirective: opts.ownerDirective,
      });
    }

    // Feasibility check
    if (this.feasibilityChecker) {
      hypothesis.feasibility = await this.feasibilityChecker.assess(hypothesis);
    }

    hypothesis.id = id;
    hypothesis.createdAt = Date.now();
    hypothesis.seedTopic = seedTopic;
    return hypothesis;
  }

  _pickSeedTopic() {
    if (!this.kg || this.kg.nodes.size === 0) return null;
    const ids = [...this.kg.nodes.keys()];
    return ids[Math.floor(Math.random() * ids.length)];
  }

  _templateGenerate(ctx) {
    const tpl = HYPOTHESIS_TEMPLATES[Math.floor(Math.random() * HYPOTHESIS_TEMPLATES.length)];
    const fill = {
      B_old: '5 T',
      B_new: '20 T',
      magnet: 'REBCO HTS coils',
      gain: '64',
      radius_reduction: '4',
      liquid_metal: 'lithium-lead',
      tbr_target: '1.15',
      availability: '95%',
      concept: 'p-B11',
      efficiency: '85%',
      neutron_threshold: '0.5%',
      driver: 'Z-pinch',
      target: 'DT',
      rho_R: '2',
      driver_energy: '50',
      rep_rate: '0.1',
      Q: '50',
    };
    let statement = tpl.template;
    for (const [k, v] of Object.entries(fill)) {
      statement = statement.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }

    return {
      statement,
      rationale: `Synthesised by combining the ${tpl.pattern.join(' + ')} pattern with seed topic "${ctx.seedTopic ?? 'unknown'}" and ${ctx.neighbourhood.length} graph neighbours.`,
      supportingConcepts: ctx.neighbourhood.slice(0, 5).map(n => n.node?.id).filter(Boolean),
      predictedImpact: {
        metric: 'Q_factor',
        direction: 'increase',
        magnitude: fill.Q,
      },
      feasibility: { tier: 'mid_term', confidence: 0.55 },
      patentabilityHint: 'MAYBE',
      proposedExperiments: [
        'Simulate magneto-hydrodynamic stability at the proposed field strength.',
        'Measure TBR under realistic neutron spectrum.',
        'Bench-test direct-conversion electrode erosion.',
      ],
      source: 'template',
      templatePattern: tpl.pattern,
    };
  }

  async _llmGenerate(ctx) {
    const system = [
      'You are FUSIONARY, an autonomous scientific researcher specialised in nuclear fusion energy.',
      'Your task is to generate a NOVEL, FEASIBLE, and PATENT-ELIGIBLE scientific hypothesis',
      'that advances the goal of a safe, practically inexhaustible fusion energy source at the',
      'short-to-medium term (1-15 years).',
      '',
      'Constraints:',
      '1. The hypothesis must be anchored to technologies that exist today or that are being built',
      '   (ITER, SPARC, NIF, Wendelstein 7-X, MagLIF, REBCO magnets, etc.).',
      '2. Avoid speculative physics — no cold fusion, no muon-catalysed at industrial scale,',
      '   no aneutronic p-B11 in a tokamak.',
      '3. The hypothesis should propose a measurable improvement in Q-factor, TBR, LCOE,',
      '   availability, or safety margin.',
      '4. Identify 2-4 candidate patent claims.',
      '',
      'Respond ONLY with a JSON object of the shape:',
      '{',
      '  "statement": "<one-paragraph hypothesis statement>",',
      '  "rationale": "<why this is novel and feasible>",',
      '  "supportingConcepts": ["<knowledge graph node id or label>", ...],',
      '  "predictedImpact": { "metric": "Q_factor|TBR|LCOE|availability", "direction": "increase|decrease", "magnitude": "<value>" },',
      '  "feasibility": { "tier": "current|near_term|mid_term|long_term", "confidence": 0.0-1.0 },',
      '  "patentabilityHint": "YES|MAYBE|NO",',
      '  "proposedExperiments": ["<experiment 1>", "<experiment 2>", ...],',
      '  "candidatePatentClaims": ["<claim 1>", "<claim 2>", ...]',
      '}',
    ].join('\n');

    const user = [
      `Seed topic: ${ctx.seedTopic ?? 'random'}`,
      `Owner directive: ${ctx.ownerDirective ?? '(none)'}`,
      `Under-explored concepts: ${ctx.underExplored.map(u => u.node?.label).join(', ')}`,
      `Neighbourhood concepts: ${ctx.neighbourhood.map(n => n.node?.label).slice(0, 8).join(', ')}`,
      '',
      'Generate ONE hypothesis now.',
    ].join('\n');

    const response = await this.llm.chat(user, system);
    if (!response?.ok) {
      this.emit('llmError', response?.error ?? 'unknown');
      return this._templateGenerate(ctx);
    }
    try {
      // Try to parse JSON out of the response
      const text = response.content ?? '';
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}');
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        const jsonStr = text.slice(jsonStart, jsonEnd + 1);
        const parsed = JSON.parse(jsonStr);
        return {
          ...parsed,
          source: 'llm',
          rawLlmResponse: text,
        };
      }
    } catch (err) {
      this.emit('parseError', err.message);
    }
    // Fallback
    return this._templateGenerate(ctx);
  }
}
