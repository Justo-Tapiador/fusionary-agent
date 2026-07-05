/**
 * run.js — FUSIONARY (v1.0) minimal test runner
 * Smoke-tests the core modules without requiring an LLM API key.
 */

import { FusionKnowledgeGraph } from '../src/modules/FusionKnowledgeGraph.js';
import { ResourceFeasibilityChecker, RESOURCE_ANCHORS } from '../src/modules/ResourceFeasibilityChecker.js';
import { DocumentArchivist } from '../src/modules/DocumentArchivist.js';
import { HypothesisGenerator } from '../src/modules/HypothesisGenerator.js';
import { PatentDraftAssistant } from '../src/modules/PatentDraftAssistant.js';
import { PlasmaPhysicsTool } from '../src/tools/PlasmaPhysicsTool.js';
import { ArtificialJunkyNeuron, AJNPhase } from '../src/core/ArtificialJunkyNeuron.js';

let passed = 0, failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else      { failed++; console.error(`  ✗ ${msg}`); }
}

async function test() {
  console.log('\n=== FUSIONARY v1.0 — smoke tests ===\n');

  console.log('1. Knowledge graph seeds correctly:');
  const kg = new FusionKnowledgeGraph({ storagePath: '/tmp/fusionary_kg_test.json' });
  await kg.init();
  assert(kg.nodes.size >= 10, `KG has ≥10 seeded nodes (got ${kg.nodes.size})`);
  assert(kg.edges.size >= 10, `KG has ≥10 seeded edges (got ${kg.edges.size})`);
  assert(kg.search('tokamak').length > 0, 'KG search for "tokamak" returns results');

  console.log('\n2. Plasma physics tool computes D-T <σv>:');
  const plasma = new PlasmaPhysicsTool();
  const sv = await plasma.execute({ operation: 'sigmav', params: { T_keV: 15, fuel: 'D-T' } });
  assert(sv.ok, 'sigmav operation returns ok');
  assert(sv.result.sigmav_cm3_s > 1e-20, `D-T <σv> at 15 keV is reasonable (got ${sv.result.sigmav_cm3_s.toExponential(3)})`);

  const lawson = await plasma.execute({ operation: 'lawson', params: { T_keV: 15, fuel: 'D-T' } });
  assert(lawson.ok, 'lawson operation returns ok');
  assert(lawson.result.triple_product_keV_s_m3 > 1e20, `Lawson triple product > 1e20 (got ${lawson.result.triple_product_keV_s_m3.toExponential(3)})`);

  console.log('\n3. Resource feasibility checker rejects speculative physics:');
  const checker = new ResourceFeasibilityChecker({ kg });
  const v1 = await checker.assess({
    statement: 'A tokamak using REBCO magnets at 12 T like SPARC',
    parameters: { fieldT: 12, Q: 11 },
    supportingConcepts: ['concept_tokamak'],
  });
  assert(v1.tier === 'near_term' || v1.tier === 'mid_term', `12 T / Q=11 verdict is near/mid_term (got ${v1.tier})`);

  const v2 = await checker.assess({
    statement: 'A speculative device with no anchor',
    parameters: { fieldT: 50 },
    supportingConcepts: [],
  });
  assert(v2.tier === 'speculative', `50 T field with no anchor is speculative (got ${v2.tier})`);
  assert(v2.patentEligible === false, 'Speculative verdict is not patent-eligible');

  console.log('\n4. Hypothesis generator works without LLM:');
  const hg = new HypothesisGenerator({ kg, llm: null, feasibilityChecker: checker });
  const hyps = await hg.generate({ count: 1 });
  assert(hyps.length === 1, 'Generated exactly 1 hypothesis');
  assert(typeof hyps[0].statement === 'string' && hyps[0].statement.length > 0, 'Hypothesis has a statement');

  console.log('\n5. Patent draft assistant produces claims:');
  const pa = new PatentDraftAssistant({ llm: null, feasibilityChecker: checker });
  const patent = await pa.draft({
    hypothesis: hyps[0],
    parameters: { confinement: 'tokamak', fuel: 'D-T', Tion: 15, magnet_type: 'REBCO', Bfield: 12 },
  });
  assert(patent.claims.length >= 2, `Patent has ≥2 claims (got ${patent.claims.length})`);
  assert(patent.claims.some(c => c.kind === 'independent'), 'Patent has at least one independent claim');

  console.log('\n6. Document archivist stores and retrieves:');
  const arc = new DocumentArchivist({ rootDir: '/tmp/fusionary_research_test' });
  const r = arc.archive({
    category: 'hypotheses',
    title: 'Test hypothesis',
    topic: 'test',
    markdownSource: '# Test',
    tags: ['intermediate_result'],
    patent: { eligible: false, claims: [] },
  });
  assert(r.id, 'Archive returns an id');
  assert(arc.list().length >= 1, 'Archive list has at least 1 document');

  console.log('\n7. AJN phase lifecycle runs:');
  const ajn = new ArtificialJunkyNeuron({ stimulusClass: 'magnetic_confinement_tokamak' });
  for (let i = 0; i < 5; i++) ajn.process({ intensity: Math.random() });
  assert(ajn.step === 5, `AJN ran 5 steps (got ${ajn.step})`);
  assert(Object.values(AJNPhase).includes(ajn.phase), `AJN phase is valid (got ${ajn.phase})`);

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

test().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
