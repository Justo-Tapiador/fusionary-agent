/**
 * PatentDraftAssistant.js — FUSIONARY (v1.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Translates hypothesis + design documents into structured patent
 * application drafts following USPTO/EPO conventions:
 *
 *   - Title
 *   - Abstract
 *   - Field of the Invention
 *   - Background
 *   - Summary
 *   - Brief Description of Drawings
 *   - Detailed Description
 *   - Claims (independent + dependent)
 *   - Abstract (repeated)
 *
 * Uses an LLM when available; otherwise falls back to a deterministic
 * template-based drafter that produces syntactically valid claims.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';

const CLAIM_PATTERNS = [
  {
    kind: 'independent',
    template: 'A fusion reactor system comprising: a {confinement} configured to confine a plasma of {fuel} at a temperature of at least {Tion} keV; a {breeder_or_driver} operably coupled to the {confinement}; and a control system configured to maintain a confinement parameter {parameter} within a range of {range}.',
  },
  {
    kind: 'dependent',
    template: 'The system of claim {parent}, wherein the {confinement} employs {magnet_type} coils producing a peak field of at least {Bfield} T at the plasma boundary.',
  },
  {
    kind: 'dependent',
    template: 'The system of claim {parent}, wherein the {breeder_or_driver} includes a {first_wall} lining configured to operate at a heat flux of at least {heat_flux} MW/m².',
  },
  {
    kind: 'independent',
    template: 'A method for generating net energy from nuclear fusion, the method comprising: providing {fuel} in a {confinement}; applying {driver_energy} of energy to compress or heat the {fuel} to a temperature of at least {Tion} keV; and extracting heat from the {confinement} via a {coolant} coolant at a rate sufficient to maintain a wall-plug efficiency above {efficiency}%',
  },
];

export class PatentDraftAssistant extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.llm = opts.llm ?? null;
    this.feasibilityChecker = opts.feasibilityChecker ?? null;
  }

  /**
   * Draft a patent application from a hypothesis + design payload.
   * @param {object} payload
   * @param {object} payload.hypothesis
   * @param {object} [payload.design]
   * @param {object} [payload.parameters]  – merged engineering parameters
   * @returns {object} patentDraft
   */
  async draft(payload) {
    const id = `patent_${uuidv4().slice(0, 8)}`;
    let draft;
    if (this.llm) {
      draft = await this._llmDraft(id, payload);
    } else {
      draft = this._templateDraft(id, payload);
    }

    // Sanity check feasibility
    if (this.feasibilityChecker) {
      draft.feasibility = await this.feasibilityChecker.assess({
        statement: draft.abstract,
        parameters: payload.parameters ?? {},
        supportingConcepts: payload.hypothesis?.supportingConcepts ?? [],
      });
    }

    draft.id = id;
    draft.createdAt = Date.now();
    draft.hypothesisId = payload.hypothesis?.id ?? null;
    this.emit('drafted', draft);
    return draft;
  }

  // ── Template-based drafter (no LLM required) ──────────────────────────────

  _templateDraft(id, payload) {
    const h = payload.hypothesis ?? {};
    const p = Object.assign({
      confinement: 'tokamak',
      fuel: 'D-T',
      Tion: 15,
      breeder_or_driver: 'tritium breeding blanket',
      magnet_type: 'REBCO HTS',
      Bfield: 12,
      first_wall: 'tungsten-faced',
      heat_flux: 1,
      coolant: 'helium',
      efficiency: 30,
      driver_energy: '0 MJ',
      parameter: 'β_N',
      range: '2.5-3.5',
    }, payload.parameters ?? {});

    const claims = [];
    let claimNum = 1;
    for (const pat of CLAIM_PATTERNS) {
      const text = pat.template
        .replace(/\{confinement\}/g, p.confinement)
        .replace(/\{fuel\}/g, p.fuel)
        .replace(/\{Tion\}/g, p.Tion)
        .replace(/\{breeder_or_driver\}/g, p.breeder_or_driver)
        .replace(/\{magnet_type\}/g, p.magnet_type)
        .replace(/\{Bfield\}/g, p.Bfield)
        .replace(/\{first_wall\}/g, p.first_wall)
        .replace(/\{heat_flux\}/g, p.heat_flux)
        .replace(/\{coolant\}/g, p.coolant)
        .replace(/\{efficiency\}/g, p.efficiency)
        .replace(/\{driver_energy\}/g, p.driver_energy)
        .replace(/\{parameter\}/g, p.parameter)
        .replace(/\{range\}/g, p.range)
        .replace(/\{parent\}/g, String(Math.max(1, claimNum - 1)));
      claims.push({ number: claimNum, kind: pat.kind, text });
      claimNum++;
    }

    return {
      title: `Fusion Reactor System and Method Based on ${p.confinement} Confinement with ${p.magnet_type} Magnets`,
      abstract: h.statement ?? `A ${p.confinement}-based fusion reactor system employing ${p.magnet_type} magnets, ${p.breeder_or_driver}, and a ${p.first_wall} first wall, achieving net energy gain via ${p.fuel} fusion at ${p.Tion} keV ion temperature.`,
      field: 'Nuclear fusion energy; plasma confinement; tritium breeding; high-temperature superconducting magnets.',
      background: [
        `Current fusion research programs (ITER, SPARC, NIF) target Q > 1 demonstrations within the next decade.`,
        `However, no existing reactor concept simultaneously achieves the required combination of plasma stability,`,
        `tritium self-sufficiency, and first-wall survivability for commercial deployment.`,
        `This disclosure addresses that gap by combining ${p.magnet_type} magnets with ${p.first_wall} first-wall technology and a ${p.coolant} coolant loop.`,
      ].join(' '),
      summary: h.rationale ?? 'See hypothesis rationale.',
      drawings: [
        'FIG. 1 — Reactor cross-section showing confinement, blanket, and first wall.',
        'FIG. 2 — Magnetic field topology with REBCO coil arrangement.',
        'FIG. 3 — Coolant flow diagram and heat extraction path.',
        'FIG. 4 — Tritium breeding and fuel cycle block flow diagram.',
      ],
      detailedDescription: [
        'DETAILED DESCRIPTION',
        '',
        `Referring now to FIG. 1, the fusion reactor system 100 comprises a ${p.confinement} 110,`,
        `a ${p.breeder_or_driver} 120, a ${p.first_wall} first wall 130, and a control system 140.`,
        `The ${p.confinement} 110 confines a plasma of ${p.fuel} fuel at an ion temperature of at least ${p.Tion} keV.`,
        `The ${p.magnet_type} coils 112 produce a peak magnetic field of at least ${p.Bfield} T at the plasma boundary.`,
        '',
        `In operation, the ${p.breeder_or_driver} 120 maintains a ${p.parameter} within the range of ${p.range},`,
        `while the first wall 130 withstands a heat flux of at least ${p.heat_flux} MW/m². Heat is extracted via the ${p.coolant} coolant 150`,
        `at a wall-plug efficiency above ${p.efficiency}%.`,
        '',
        'The embodiments described herein are illustrative; numerous modifications will be apparent',
        'to those skilled in the art without departing from the scope of the appended claims.',
      ].join('\n'),
      claims,
      source: 'template',
    };
  }

  // ── LLM-based drafter ──────────────────────────────────────────────────────

  async _llmDraft(id, payload) {
    const system = [
      'You are FUSIONARY-PATENT, a specialised patent attorney agent.',
      'Draft a USPTO-style patent application based on the hypothesis and design',
      'parameters provided. The output MUST be valid JSON with the keys:',
      '  title, abstract, field, background, summary, drawings (array of strings),',
      '  detailedDescription (string with \\\\n separators), claims (array of {number, kind, text}).',
      'Constraints:',
      '  - At least 1 independent claim and 2 dependent claims.',
      '  - All claims must be anchored to physically realisable components.',
      '  - Do NOT include legal disclaimers or boilerplate.',
    ].join('\n');

    const user = [
      `Hypothesis: ${JSON.stringify(payload.hypothesis ?? {}, null, 2)}`,
      `Design: ${JSON.stringify(payload.design ?? {}, null, 2)}`,
      `Parameters: ${JSON.stringify(payload.parameters ?? {}, null, 2)}`,
      '',
      'Draft the patent application now (JSON only).',
    ].join('\n');

    const response = await this.llm.chat(user, system);
    if (!response?.ok) {
      this.emit('llmError', response?.error ?? 'unknown');
      return this._templateDraft(id, payload);
    }
    try {
      const text = response.content ?? '';
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}');
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
        return { ...parsed, source: 'llm', rawLlmResponse: text };
      }
    } catch (err) {
      this.emit('parseError', err.message);
    }
    return this._templateDraft(id, payload);
  }
}
