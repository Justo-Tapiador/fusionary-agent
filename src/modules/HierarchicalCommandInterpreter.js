/**
 * HierarchicalCommandInterpreter.js — FUSIONARY (v1.0)
 * Parses owner directives into a structured research plan.
 *
 * Owner directives can be:
 *   - Free-form English: "Focus on tritium breeding TBR > 1.15"
 *   - Structured: { topic, parameters, target_metric, max_iterations }
 *   - Empty/null: autonomous mode (agent picks topic from under-explored KG regions)
 *
 * Output: a ResearchPlan object the FusionaryAgent can execute.
 */

import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';

const DEFAULT_PLAN = {
  topic: null,
  parameters: {},
  targetMetric: 'Q_factor',
  targetValue: null,
  maxIterations: 10,
  maxTokensPerIteration: 8000,
  deliverables: ['hypothesis', 'design', 'patent_draft'],
  safetyLevel: 'standard',
  ownerDirective: null,
};

export class HierarchicalCommandInterpreter extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.llm = opts.llm ?? null;
    this.kg = opts.kg ?? null;
  }

  /**
   * Interpret an owner directive into a structured plan.
   * @param {string|object|null} directive
   * @returns {Promise<object>} plan
   */
  async interpret(directive) {
    if (!directive || (typeof directive === 'string' && !directive.trim())) {
      // Autonomous mode
      return this._autonomousPlan();
    }

    if (typeof directive === 'object') {
      return { ...DEFAULT_PLAN, ...directive, id: uuidv4() };
    }

    // Try LLM parsing first
    if (this.llm) {
      const llmPlan = await this._llmParse(directive);
      if (llmPlan) return { ...DEFAULT_PLAN, ...llmPlan, id: uuidv4(), ownerDirective: directive };
    }

    // Fallback: regex-based keyword extraction
    return { ...DEFAULT_PLAN, ...this._regexParse(directive), id: uuidv4(), ownerDirective: directive };
  }

  _autonomousPlan() {
    // Pick the most under-explored topic from the KG
    let topic = null;
    if (this.kg) {
      const underExplored = this.kg.findUnderExplored(1);
      if (underExplored.length > 0) topic = underExplored[0].node?.id;
    }
    return {
      ...DEFAULT_PLAN,
      id: uuidv4(),
      topic,
      parameters: {},
      ownerDirective: null,
      autonomous: true,
    };
  }

  _regexParse(text) {
    const plan = { parameters: {} };
    const lower = text.toLowerCase();

    // Field strength
    const fieldMatch = lower.match(/(\d+(?:\.\d+)?)\s*t(?:esla)?/);
    if (fieldMatch) plan.parameters.fieldT = parseFloat(fieldMatch[1]);

    // TBR
    const tbrMatch = lower.match(/tbr\s*(?:>|>=)?\s*(\d+(?:\.\d+)?)/);
    if (tbrMatch) {
      plan.parameters.tbr = parseFloat(tbrMatch[1]);
      plan.targetMetric = 'TBR';
      plan.targetValue = parseFloat(tbrMatch[1]);
    }

    // Q factor
    const qMatch = lower.match(/q\s*(?:>|>=)?\s*(\d+(?:\.\d+)?)/);
    if (qMatch) {
      plan.parameters.Q = parseFloat(qMatch[1]);
      plan.targetMetric = 'Q_factor';
      plan.targetValue = parseFloat(qMatch[1]);
    }

    // Topic keywords
    const topicMap = {
      'tokamak': 'concept_tokamak',
      'stellarator': 'concept_stellarator',
      'icf': 'concept_icf',
      'inertial': 'concept_icf',
      'mif': 'concept_mif',
      'magneto-inertial': 'concept_mif',
      'p-b11': 'concept_pb11',
      'pb11': 'concept_pb11',
      'boron': 'concept_pb11',
      'breeding': 'concept_tritium_breeder',
      'tritium': 'concept_tritium_breeder',
      'liquid lithium': 'concept_liquid_lithium',
      'reco': 'concept_reco_magnet',
      'hts': 'concept_reco_magnet',
    };
    for (const [kw, topicId] of Object.entries(topicMap)) {
      if (lower.includes(kw)) {
        plan.topic = topicId;
        break;
      }
    }

    // Safety level
    if (lower.includes('strict')) plan.safetyLevel = 'strict';
    else if (lower.includes('permissive')) plan.safetyLevel = 'permissive';

    return plan;
  }

  async _llmParse(text) {
    if (!this.llm) return null;
    const system = [
      'You are the Hierarchical Command Interpreter of FUSIONARY.',
      'Parse the user directive into a structured research plan.',
      'Respond ONLY with a JSON object of shape:',
      '{',
      '  "topic": "<knowledge graph node id, e.g. concept_tokamak>",',
      '  "parameters": { "fieldT": 12, "Q": 10, ... },',
      '  "targetMetric": "Q_factor|TBR|LCOE|availability",',
      '  "targetValue": <number>,',
      '  "maxIterations": <number>,',
      '  "deliverables": ["hypothesis", "design", "patent_draft"],',
      '  "safetyLevel": "standard|strict|permissive"',
      '}',
    ].join('\n');
    try {
      const r = await this.llm.chat(text, system);
      if (!r?.ok) return null;
      const s = r.content ?? '';
      const a = s.indexOf('{');
      const b = s.lastIndexOf('}');
      if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
    } catch (err) {
      this.emit('parseError', err.message);
    }
    return null;
  }
}
