/**
 * ResourceFeasibilityChecker.js — FUSIONARY (v1.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Anchors every proposed solution to the actual resources of human
 * civilisation. Produces a structured feasibility verdict:
 *
 *   tier:    current | near_term | mid_term | long_term | speculative
 *   anchors: list of existing facilities / technologies that support the claim
 *   gaps:    list of missing capabilities that must be developed
 *   cost:    rough order-of-magnitude estimate (USD)
 *   timeline: years-to-first-net-energy estimate
 *   safety:  { neutron_load_MWm2, tritium_inventory_kg, activated_mass_t }
 *
 * Used as a hard gate before any document is marked patent-eligible.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { EventEmitter } from 'eventemitter3';

// Resource anchors: the actual industrial / scientific capacity of
// human civilisation as of 2026. Every claim must trace back to at
// least one anchor or be flagged as speculative.
const RESOURCE_ANCHORS = Object.freeze({
  // Magnetic confinement
  ITER: {
    label: 'ITER (Saint-Paul-lès-Durance, FR)',
    status: 'under_construction',
    firstPlasma: 2034,
    fieldT: 5.3,
    majorRadiusM: 6.2,
    qTarget: 10,
    costUSD: 22e9,
  },
  SPARC: {
    label: 'SPARC / Commonwealth Fusion Systems (Devens, MA, USA)',
    status: 'under_construction',
    firstPlasma: 2027,
    fieldT: 12,
    majorRadiusM: 1.65,
    qTarget: 11,
    costUSD: 5e9,
  },
  Wendelstein7X: {
    label: 'Wendelstein 7-X (Greifswald, DE)',
    status: 'operating',
    fieldT: 3,
    majorRadiusM: 5.5,
    qTarget: null,  // not designed for net energy
    costUSD: 1.1e9,
  },
  EAST: {
    label: 'EAST (Hefei, CN)',
    status: 'operating',
    fieldT: 3.5,
    majorRadiusM: 1.95,
    qTarget: null,
  },
  KSTAR: {
    label: 'KSTAR (Daejeon, KR)',
    status: 'operating',
    fieldT: 3.5,
    majorRadiusM: 1.8,
  },
  // Inertial confinement
  NIF: {
    label: 'National Ignition Facility (Livermore, CA, USA)',
    status: 'operating',
    laserEnergyMJ: 1.9,
    shotsPerDay: 1, // very low rep rate
    gainAchieved: 1.5, // Dec 2022 result
    costUSD: 3.5e9,
  },
  Laser_MegeJoule: {
    label: 'Laser Mégajoule (Bordeaux, FR)',
    status: 'operating',
    laserEnergyMJ: 1.3,
  },
  // Pulsed power / MIF
  ZMachine: {
    label: 'Z Machine (Sandia, NM, USA)',
    status: 'operating',
    peakCurrentMA: 27,
    costUSD: 1.5e9,
  },
  ShenguangIII: {
    label: 'Shenguang-III (Mianyang, CN)',
    status: 'operating',
    laserEnergyKJ: 180,
  },
  // Industrial / materials
  REBCO_tape_production: {
    label: 'REBCO HTS tape industrial production (Faraday, THEVA, Sumitomo)',
    status: 'available',
    annualKm: 1000, // global capacity
    costPerMeterUSD: 200,
  },
  Lithium_supply: {
    label: 'Global lithium supply (USGS 2024)',
    status: 'available',
    annualTonnes: 180000,
    reservesTonnes: 26_000_000,
  },
  Beryllium_supply: {
    label: 'Beryllium supply (Brush Wellman, Materion)',
    status: 'available',
    annualTonnes: 220,
    constraint: 'toxic, restricted supply',
  },
  Tritium_inventory: {
    label: 'Global tritium inventory (2024)',
    status: 'available',
    kgAvailable: 25,
    notes: 'Decaying at 5.5%/yr; CANDU stockpile the main source',
  },
  Steel_HSLA: {
    label: 'High-strength low-alloy steel (industrial)',
    status: 'available',
    costPerTonneUSD: 1200,
  },
  Tungsten_supply: {
    label: 'Tungsten supply (refractory metal)',
    status: 'available',
    annualTonnes: 80000,
  },
  // Energy / construction
  Nuclear_fission_build: {
    label: 'Nuclear fission EPC capacity (global)',
    status: 'available',
    annualGW: 8,
    typicalLCOE_USDperMWh: 90,
  },
});

const FEASIBILITY_RULES = [
  // If claim mentions a field strength that exceeds REBCO demonstrated capacity
  {
    id: 'rule_field_strength',
    test: (claim) => {
      const B = claim.parameters?.fieldT;
      if (typeof B !== 'number') return null;
      if (B > 25) return { tier: 'speculative', reason: `Field ${B} T exceeds demonstrated REBCO peak (~20 T on coil)` };
      if (B > 12) return { tier: 'long_term', reason: `Field ${B} T requires R&D beyond SPARC's 12 T design` };
      if (B > 5)  return { tier: 'near_term', reason: `Field ${B} T in SPARC-class envelope` };
      return { tier: 'current', reason: `Field ${B} T achievable with ITER-class magnets` };
    },
  },
  // Tritium breeding ratio
  {
    id: 'rule_tbr',
    test: (claim) => {
      const tbr = claim.parameters?.tbr;
      if (typeof tbr !== 'number') return null;
      if (tbr < 1.0) return { tier: 'speculative', reason: `TBR ${tbr} < 1.0 — reactor is a net tritium consumer` };
      if (tbr < 1.05) return { tier: 'long_term', reason: `TBR ${tbr} marginal; breeding margin insufficient for doublet failure` };
      if (tbr < 1.15) return { tier: 'mid_term', reason: `TBR ${tbr} requires validated blanket module tests (HCPB/DFLP)'` };
      return { tier: 'near_term', reason: `TBR ${tbr} above 1.15 with margin` };
    },
  },
  // Q factor target
  {
    id: 'rule_q_factor',
    test: (claim) => {
      const Q = claim.parameters?.Q;
      if (typeof Q !== 'number') return null;
      if (Q < 1) return { tier: 'speculative', reason: `Q=${Q} — no net energy` };
      if (Q < 5) return { tier: 'mid_term', reason: `Q=${Q} below engineering breakeven (~5)` };
      if (Q < 10) return { tier: 'near_term', reason: `Q=${Q} in ITER target range` };
      return { tier: 'near_term', reason: `Q=${Q} in SPARC/ARC range` };
    },
  },
  // p-B11 temperature
  {
    id: 'rule_pb11_temp',
    test: (claim) => {
      if (!claim.fuel || claim.fuel !== 'p-B11') return null;
      const T = claim.parameters?.Tion_keV;
      if (typeof T !== 'number') return { tier: 'speculative', reason: 'p-B11 requires T_ion ~ 300 keV; not specified' };
      if (T < 100) return { tier: 'speculative', reason: `p-B11 at T=${T} keV — far below ignition ~300 keV` };
      return { tier: 'long_term', reason: `p-B11 at T=${T} keV — achievable only with non-thermal schemes` };
    },
  },
  // Tritium inventory
  {
    id: 'rule_tritium_inventory',
    test: (claim) => {
      const ti = claim.parameters?.tritiumInventoryKg;
      if (typeof ti !== 'number') return null;
      if (ti > 25) return { tier: 'speculative', reason: `Requires ${ti} kg T — exceeds global inventory (25 kg)` };
      if (ti > 5)  return { tier: 'long_term', reason: `Requires ${ti} kg T — large breeding startup inventory` };
      return { tier: 'mid_term', reason: `Requires ${ti} kg T — within reach with breeding startup` };
    },
  },
];

export class ResourceFeasibilityChecker extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.kg = opts.kg ?? null;
  }

  /**
   * Assess a hypothesis or design proposal.
   * @param {object} claim  – { statement, parameters, supportingConcepts, ... }
   * @returns {object} verdict
   */
  async assess(claim) {
    const anchors = this._findAnchors(claim);
    const ruleResults = FEASIBILITY_RULES
      .map(rule => rule.test(claim))
      .filter(r => r !== null);

    // Pick the most pessimistic tier
    const tierOrder = ['current', 'near_term', 'mid_term', 'long_term', 'speculative'];
    let worstTier = 'current';
    for (const r of ruleResults) {
      if (tierOrder.indexOf(r.tier) > tierOrder.indexOf(worstTier)) worstTier = r.tier;
    }
    if (anchors.length === 0) worstTier = 'speculative';

    const costEstimate = this._estimateCost(claim, worstTier);
    const timelineEstimate = this._estimateTimeline(worstTier);
    const safetyProfile = this._safetyProfile(claim);

    const verdict = {
      tier: worstTier,
      confidence: this._confidence(anchors.length, ruleResults.length),
      anchors,
      ruleResults,
      gaps: this._findGaps(claim, anchors),
      costEstimate,
      timelineEstimate,
      safetyProfile,
      patentEligible: worstTier !== 'speculative' && anchors.length >= 1,
    };

    this.emit('assessed', { claim, verdict });
    return verdict;
  }

  _findAnchors(claim) {
    const found = [];
    const text = `${claim.statement ?? ''} ${JSON.stringify(claim.parameters ?? {})} ${(claim.supportingConcepts ?? []).join(' ')}`.toLowerCase();
    for (const [id, anchor] of Object.entries(RESOURCE_ANCHORS)) {
      const label = (anchor.label ?? id).toLowerCase();
      const keywords = [id.toLowerCase().replace(/_/g, ' '), label.split('(')[0].trim()];
      if (keywords.some(k => text.includes(k))) found.push({ id, ...anchor });
    }
    return found;
  }

  _findGaps(claim, anchors) {
    const gaps = [];
    const p = claim.parameters ?? {};
    if (p.fieldT > 12 && !anchors.find(a => a.id === 'SPARC' || a.id === 'REBCO_tape_production')) {
      gaps.push('High-field magnet R&D — need validated REBCO coils above 12 T');
    }
    if (p.fuel === 'D-T' && (p.tbr ?? 0) < 1.1 && !anchors.find(a => a.id === 'Tritium_inventory')) {
      gaps.push('Tritium breeding module validation at prototype scale');
    }
    if (p.driverType === 'laser' && !anchors.find(a => a.id === 'NIF' || a.id === 'Laser_MegeJoule')) {
      gaps.push('High-rep-rate laser driver (10 Hz-class, >1 MJ)');
    }
    if (p.firstWall === 'liquid_lithium' && !anchors.find(a => a.id === 'Lithium_supply')) {
      gaps.push('Liquid lithium loop validation with tritium extraction');
    }
    return gaps;
  }

  _estimateCost(claim, tier) {
    const base = {
      current: 1e8,         // $100M
      near_term: 1e9,       // $1B
      mid_term: 5e9,        // $5B
      long_term: 20e9,      // $20B
      speculative: 50e9,    // $50B+
    };
    return {
      low: base[tier] ?? 1e9,
      high: (base[tier] ?? 1e9) * 5,
      currency: 'USD',
      note: 'Order-of-magnitude estimate; refine with bottom-up EPC analysis.',
    };
  }

  _estimateTimeline(tier) {
    return {
      current: '0-2 years',
      near_term: '2-7 years',
      mid_term: '7-15 years',
      long_term: '15-30 years',
      speculative: '>30 years or unknown',
    }[tier] ?? 'unknown';
  }

  _safetyProfile(claim) {
    const p = claim.parameters ?? {};
    return {
      neutronLoadMWm2: p.neutronLoadMWm2 ?? (p.fuel === 'p-B11' ? 0.05 : 1.5),
      tritiumInventoryKg: p.tritiumInventoryKg ?? (p.fuel === 'D-T' ? 2 : 0),
      activatedMassTonnes: p.activatedMassTonnes ?? (p.fuel === 'p-B11' ? 50 : 5000),
      note: 'Aneutronic fuels dramatically reduce activation and shielding needs.',
    };
  }

  _confidence(anchorCount, ruleCount) {
    // Confidence rises with the number of anchors and rules that fired
    const base = Math.min(1.0, 0.3 + 0.15 * anchorCount + 0.1 * ruleCount);
    return Math.round(base * 100) / 100;
  }
}

export { RESOURCE_ANCHORS, FEASIBILITY_RULES };
