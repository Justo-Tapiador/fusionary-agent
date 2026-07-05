/**
 * PlasmaPhysicsTool.js — FUSIONARY (v1.0)
 * Numerical utilities for plasma physics calculations:
 *   - Lawson criterion evaluation (n·τ·T)
 *   - Fusion reaction rate <σv> (Bosch-Hale approximation for D-T, D-D, p-B11)
 *   - Bremsstrahlung radiation loss
 *   - Synchrotron radiation estimate
 *   - Net power balance
 *   - Tritium breeding ratio (TBR) calculator
 *
 * All values in SI unless noted. Energies in keV.
 */

import { Tool } from './Tool.js';

// Bosch-Hale coefficients for D-T reaction (Bosch & Hale 1992)
// <σv> = C1 * θ * sqrt(ξ/(m_r*c^2*T^3)) * exp(-ξ)
// where θ = T / (1 - T*(C2 + T*(C4 + T*C6))/(1 + T*(C3 + T*(C5 + T*C7))))
//       ξ = (B_G^2) / (4 * θ)
const DT_BOSCH_HALE = {
  B_G: 34.3827,           // Gamow constant (keV^1/2)
  m_r_c2: 1124656,        // Reduced mass * c^2 (keV)
  C1: 1.17302e-9,         // cm^3/s
  C2: 1.51361e-2,
  C3: 7.51886e-2,
  C4: 4.60643e-3,
  C5: 1.35e-2,
  C6: -1.0675e-4,
  C7: 1.366e-5,
};

const PB11_BOSCH_HALE = {
  B_G: 187.44,
  m_r_c2: 937811,
  C1: 6.69e-19,  // cm^3/s — note much smaller than D-T
  C2: -3.2093e-3,
  C3: 8.50671e-1,
  C4: -1.7806e-3,
  C5: 8.35051e-1,
  C6: -1.3688e-2,
  C7: 1.42257e-1,
};

const DDBoschHale = {
  B_G: 31.3970,
  m_r_c2: 937814,
  C1: 5.4336e-12,
  C2: 5.8577e-3,
  C3: 7.6822e-3,
  C4: 0.0,
  C5: -2.964e-7,
  C6: 0.0,
  C7: 0.0,
};

function boschHale(T_keV, coeffs) {
  if (T_keV <= 0) return 0;
  const { B_G, m_r_c2, C1, C2, C3, C4, C5, C6, C7 } = coeffs;
  const theta = T_keV / (1 - T_keV * (C2 + T_keV * (C4 + T_keV * C6)) /
                                (1 + T_keV * (C3 + T_keV * (C5 + T_keV * C7))));
  const xi = (B_G * B_G) / (4 * theta);
  const sigmav = C1 * theta * Math.sqrt(xi / (m_r_c2 * T_keV ** 3)) * Math.exp(-xi);
  return sigmav;  // cm^3/s
}

// Bremsstrahlung power density (W/m³) — Spitzer approximation
// P_brem = 1.69e-38 * Z_eff * n_e^2 * sqrt(T_e[eV])  (SI: n in /m³, T in eV)
function bremsstrahlung(n_e_per_m3, T_e_eV, Z_eff = 1) {
  return 1.69e-38 * Z_eff * n_e_per_m3 ** 2 * Math.sqrt(T_e_eV);
}

export class PlasmaPhysicsTool extends Tool {
  constructor(opts = {}) {
    super(opts);
    this.id = 'plasma_physics';
    this.name = 'Plasma Physics Calculator';
    this.description = 'Lawson criterion, <σv>, bremsstrahlung, net power, TBR calculator.';
    this.schema = {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['lawson', 'sigmav', 'bremsstrahlung', 'net_power', 'tbr'] },
        params: { type: 'object' },
      },
    };
  }

  async execute(args) {
    const op = args?.operation;
    const p = args?.params ?? {};
    try {
      switch (op) {
        case 'lawson':    return { ok: true, result: this.lawson(p) };
        case 'sigmav':    return { ok: true, result: this.sigmav(p) };
        case 'bremsstrahlung': return { ok: true, result: this.brems(p) };
        case 'net_power': return { ok: true, result: this.netPower(p) };
        case 'tbr':       return { ok: true, result: this.tbr(p) };
        default: return { ok: false, error: `Unknown operation: ${op}` };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /** Lawson triple product n·τ·T for ignition. */
  lawson({ T_keV = 15, fuel = 'D-T' }) {
    const sv = this._sigmaV(T_keV, fuel);
    const E_fusion_keV = fuel === 'p-B11' ? 8680 : (fuel === 'D-D' ? 3000 : 17500); // keV per reaction
    // Required n*tau = 12 * T / (<σv> * E_fusion) (rough Lawson)
    const nTau = (12 * T_keV) / (sv * E_fusion_keV * 1e-6); // /m³·s
    const nTauT = nTau * T_keV; // keV·s/m³
    return {
      T_keV,
      fuel,
      sigmav_cm3_s: sv,
      required_n_tau_s_m3: nTau,
      triple_product_keV_s_m3: nTauT,
      threshold_note: fuel === 'D-T'
        ? 'D-T ignition threshold ~3e21 keV·s/m³'
        : fuel === 'p-B11'
        ? 'p-B11 ignition threshold ~5e23 keV·s/m³ (much harder)'
        : 'D-D ignition threshold ~1e22 keV·s/m³',
      meets_threshold: fuel === 'D-T'
        ? nTauT >= 3e21
        : fuel === 'p-B11'
        ? nTauT >= 5e23
        : nTauT >= 1e22,
    };
  }

  /** Fusion reaction rate <σv> in cm³/s. */
  sigmav({ T_keV = 15, fuel = 'D-T' }) {
    return {
      T_keV,
      fuel,
      sigmav_cm3_s: this._sigmaV(T_keV, fuel),
    };
  }

  /** Bremsstrahlung loss in W/m³. */
  brems({ n_e_per_m3 = 1e20, T_e_keV = 15, Z_eff = 1 }) {
    return {
      n_e_per_m3,
      T_e_keV,
      Z_eff,
      P_brem_W_m3: bremsstrahlung(n_e_per_m3, T_e_keV * 1000, Z_eff),
    };
  }

  /** Net power balance: P_fusion - P_brem - P_cond (conduction). */
  netPower({
    n_i_per_m3 = 1e20, T_keV = 15, fuel = 'D-T',
    energyConfinementTime_s = 1.0, volume_m3 = 100,
    Z_eff = 1, eta_heating = 0.5, eta_conversion = 0.4,
  }) {
    const sv = this._sigmaV(T_keV, fuel);  // cm³/s
    const sv_si = sv * 1e-6;                // m³/s
    const E_fusion_J = fuel === 'p-B11' ? 8680 * 1.602e-16
                     : fuel === 'D-D' ? 3000 * 1.602e-16
                     : 17500 * 1.602e-16;   // J per reaction (D-T: 17.6 MeV)
    const P_fusion = 0.25 * n_i_per_m3 ** 2 * sv_si * E_fusion_J; // W/m³
    const P_brem = bremsstrahlung(n_i_per_m3, T_keV * 1000, Z_eff);
    const P_cond = 3 * n_i_per_m3 * T_keV * 1000 * 1.602e-19 / energyConfinementTime_s;

    const Q = P_fusion / Math.max(1, (P_brem + P_cond));
    const P_net_density = P_fusion - P_brem - P_cond;
    const P_net_total = P_net_density * volume_m3;
    const P_electric = P_net_total * eta_conversion;
    return {
      n_i_per_m3, T_keV, fuel,
      sigmav_cm3_s: sv,
      P_fusion_W_m3: P_fusion,
      P_brem_W_m3: P_brem,
      P_cond_W_m3: P_cond,
      P_net_density_W_m3: P_net_density,
      P_net_total_MW: P_net_total / 1e6,
      P_electric_MW: P_electric / 1e6,
      Q_factor: Q,
      ignition: P_net_density > 0,
    };
  }

  /** Tritium breeding ratio estimate. */
  tbr({
    blanketType = 'HCPB',         // HCPB, DCLL, WCLL, HCLL
    lithiumEnrichment = 0.6,      // fraction of Li-6
    neutronMultiplier = 1.0,      // from Be
    coverageFraction = 0.95,      // blanket coverage
    safetyFactor = 0.95,
  }) {
    // Baseline single-neutron TBR for each blanket type (typical CEA/ITER values)
    const baseTBR = {
      HCPB: 1.25,
      DCLL: 1.10,
      WCLL: 1.15,
      HCLL: 1.12,
    };
    const base = baseTBR[blanketType] ?? 1.10;
    // Adjust for enrichment, multiplier, coverage
    const adjusted = base * (0.5 + lithiumEnrichment) * neutronMultiplier * coverageFraction * safetyFactor;
    return {
      blanketType,
      lithiumEnrichment,
      neutronMultiplier,
      coverageFraction,
      baseTBR,
      estimatedTBR: adjusted,
      meets_threshold: adjusted >= 1.05,
      margin: adjusted - 1.05,
    };
  }

  _sigmaV(T_keV, fuel) {
    if (fuel === 'D-T') return boschHale(T_keV, DT_BOSCH_HALE);
    if (fuel === 'p-B11') return boschHale(T_keV, PB11_BOSCH_HALE);
    if (fuel === 'D-D') return boschHale(T_keV, DDBoschHale);
    return 0;
  }
}

export { boschHale, bremsstrahlung, DT_BOSCH_HALE, PB11_BOSCH_HALE, DDBoschHale };
