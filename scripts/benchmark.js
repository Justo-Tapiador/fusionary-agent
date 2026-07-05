/**
 * benchmark.js — FUSIONARY (v1.0)
 * Quick performance benchmark of the core modules.
 */

import { ArtificialJunkyNeuron } from '../src/core/ArtificialJunkyNeuron.js';
import { ANNPsi } from '../src/core/ANNPsi.js';
import { PlasmaPhysicsTool } from '../src/tools/PlasmaPhysicsTool.js';

const ITERATIONS = 1000;

console.log(`\n=== FUSIONARY v1.0 — benchmark (${ITERATIONS} iterations) ===\n`);

// 1. AJN throughput
console.log('1. AJN single-neuron throughput:');
const ajn = new ArtificialJunkyNeuron({ stimulusClass: 'test' });
const t0 = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  ajn.process({ intensity: Math.random() });
}
const dt = performance.now() - t0;
console.log(`   ${ITERATIONS} steps in ${dt.toFixed(1)} ms → ${(ITERATIONS / dt * 1000).toFixed(0)} steps/s\n`);

// 2. ANN-Psi forward pass
console.log('2. ANN-Psi 14-layer forward pass:');
const ann = new ANNPsi({ dModel: 256, nHeads: 8, dFF: 1024 });
const t1 = performance.now();
for (let i = 0; i < 100; i++) {
  ann.forward({ intensity: 0.5, vector: new Float64Array(256) });
}
const dt2 = performance.now() - t1;
console.log(`   100 forward passes in ${dt2.toFixed(1)} ms → ${(100 / dt2 * 1000).toFixed(0)} passes/s\n`);

// 3. Plasma physics calculations
console.log('3. Plasma physics (Lawson + sigmav):');
const plasma = new PlasmaPhysicsTool();
const t2 = performance.now();
let dummy = 0;
for (let i = 0; i < ITERATIONS; i++) {
  const r = plasma.lawson({ T_keV: 10 + i * 0.01, fuel: 'D-T' });
  dummy += r.triple_product_keV_s_m3;
}
const dt3 = performance.now() - t2;
console.log(`   ${ITERATIONS} Lawson evals in ${dt3.toFixed(1)} ms → ${(ITERATIONS / dt3 * 1000).toFixed(0)} evals/s`);
console.log(`   (sanity check: dummy sum = ${dummy.toExponential(3)})\n`);

console.log('=== benchmark complete ===\n');
