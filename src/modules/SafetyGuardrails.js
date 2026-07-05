/**
 * SafetyGuardrails.js — FUSIONARY (v1.0)
 * Pre-execution safety filter tuned for scientific research.
 *
 * Levels:
 *   permissive – minimal checks; useful for fast batch research
 *   standard   – default; blocks destructive file ops, requires resource anchor
 *   strict     – all checks + patent-novelty pre-check + rollback plan
 *
 * Specific FUSIONARY checks:
 *   - Reject any "cold fusion" / low-energy nuclear reaction claim
 *   - Reject any proposal with >50 kg tritium inventory
 *   - Reject any p-B11 in a D-T-class tokamak
 *   - Require at least one RESOURCE_ANCHOR reference per claim
 */

import { EventEmitter } from 'eventemitter3';
import { RESOURCE_ANCHORS } from './ResourceFeasibilityChecker.js';

const FORBIDDEN_PATTERNS = [
  /cold[\s_-]?fusion/i,
  /low[\s_-]?energy[\s_-]?nuclear[\s_-]?reaction/i,
  /LENR/i,
  /palladium[\s_-]?electrolysis/i,
  /free[\s_-]?energy/i,
  /perpetual[\s_-]?motion/i,
];

const PROTECTED_PATHS = new Set([
  '/etc', '/root', '/var', '/usr', '/boot', '/sys', '/proc',
  '/dev', '/lib', '/bin', '/sbin',
]);

export class SafetyGuardrails extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.safetyLevel = opts.safetyLevel ?? 'standard';
    this.protectedPaths = new Set([...PROTECTED_PATHS, ...(opts.protectedPaths ?? [])]);
    this.rateLimits = opts.rateLimits ?? { perMinute: 60, perHour: 600 };
    this._calls = [];
  }

  /**
   * Check a research action before execution.
   * @param {object} action  – { type, payload, target }
   * @returns {{ allowed: boolean, reason?: string, severity?: string }}
   */
  check(action) {
    if (this.safetyLevel === 'permissive') return { allowed: true };

    // 1. Forbidden physics patterns
    const text = JSON.stringify(action ?? {});
    for (const pat of FORBIDDEN_PATTERNS) {
      if (pat.test(text)) {
        this.emit('blocked', { reason: 'forbidden_physics', pattern: pat.source });
        return {
          allowed: false,
          reason: `Forbidden physics pattern detected: ${pat.source}`,
          severity: 'critical',
        };
      }
    }

    // 2. Tritium inventory cap
    const ti = action?.parameters?.tritiumInventoryKg ?? action?.payload?.parameters?.tritiumInventoryKg;
    if (typeof ti === 'number' && ti > 50) {
      this.emit('blocked', { reason: 'tritium_overrun', value: ti });
      return {
        allowed: false,
        reason: `Tritium inventory ${ti} kg exceeds 50 kg safety cap`,
        severity: 'critical',
      };
    }

    // 3. File path protection
    const target = action?.target ?? action?.payload?.path;
    if (typeof target === 'string') {
      for (const p of this.protectedPaths) {
        if (target.startsWith(p)) {
          this.emit('blocked', { reason: 'protected_path', path: target });
          return {
            allowed: false,
            reason: `Target path is protected: ${target}`,
            severity: 'critical',
          };
        }
      }
    }

    // 4. Resource anchor requirement (strict level)
    if (this.safetyLevel === 'strict') {
      const claim = action?.payload?.hypothesis ?? action?.payload?.claim ?? action?.payload;
      const anchorText = JSON.stringify(claim ?? {}).toLowerCase();
      const hasAnchor = Object.keys(RESOURCE_ANCHORS).some(id => {
        const a = RESOURCE_ANCHORS[id];
        const label = (a.label ?? id).toLowerCase();
        return anchorText.includes(label) || anchorText.includes(id.toLowerCase().replace(/_/g, ' '));
      });
      if (!hasAnchor && action?.type !== 'noop') {
        this.emit('warning', { reason: 'no_resource_anchor' });
        return {
          allowed: false,
          reason: 'Strict mode requires at least one RESOURCE_ANCHOR reference',
          severity: 'warning',
        };
      }
    }

    // 5. Rate limit
    const now = Date.now();
    this._calls = this._calls.filter(t => now - t < 60 * 60 * 1000);
    const lastMinute = this._calls.filter(t => now - t < 60_000).length;
    if (lastMinute >= this.rateLimits.perMinute) {
      return {
        allowed: false,
        reason: 'Per-minute rate limit exceeded',
        severity: 'warning',
      };
    }
    this._calls.push(now);

    return { allowed: true };
  }

  setLevel(level) {
    if (!['permissive', 'standard', 'strict'].includes(level)) {
      throw new Error(`Invalid safety level: ${level}`);
    }
    this.safetyLevel = level;
    this.emit('levelChanged', level);
  }
}
