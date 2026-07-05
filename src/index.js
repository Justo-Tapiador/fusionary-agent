/**
 * FUSIONARY v1.0 — Main entry point
 * ─────────────────────────────────────────────────────────────────────────────
 * Autonomous Scientific Research Agent for Practical, Safe, Short-to-Mid-Term
 * Nuclear Fusion Energy.
 *
 * Based on the Artificial Junky Neuron (AJN) framework by Justo Tapiador
 * Garcia (UA), extended from predator-jungle-agent v2.0.
 *
 * On launch, FUSIONARY immediately begins autonomous research. It does NOT
 * wait for an owner directive (this is the AJN "addiction" property).
 * The owner can guide it at any time via the web UI or CLI.
 *
 * References:
 *   Tapiador García, J. (2024). Agentic Theory: Definition of the
 *   Artificial Junky Neuron (AJN). Preprint WALLERMAX-AI 2604.00012.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Core
export { FusionaryAgent } from './core/FusionaryAgent.js';
export { ANNPsi, FUSION_STIMULUS_CLASSES } from './core/ANNPsi.js';
export { ArtificialJunkyNeuron, AJNPhase } from './core/ArtificialJunkyNeuron.js';
export { StateSerializer } from './core/StateSerializer.js';

// Layers
export {
  HomogeneousAJNLayer,
  HeterogeneousAJNLayer,
  HybridAJNLayer,
} from './layers/AJNLayer.js';
export { TransformerBlock } from './layers/TransformerBlock.js';

// Modules
export { HierarchicalCommandInterpreter } from './modules/HierarchicalCommandInterpreter.js';
export {
  TokenEnergyArbitrator,
  PraxicStreamExecutor,
} from './modules/TokenEnergyArbitrator.js';
export { CascadeMonitor } from './modules/CascadeMonitor.js';
export { MemorySystem } from './modules/MemorySystem.js';
export { SafetyGuardrails } from './modules/SafetyGuardrails.js';
export { MetricsCollector } from './modules/MetricsCollector.js';
export { PluginManager, HOOKS as PLUGIN_HOOKS } from './modules/PluginManager.js';
export { FusionKnowledgeGraph, RELATION_TYPES, FEASIBILITY_TIERS } from './modules/FusionKnowledgeGraph.js';
export { CitationGraph } from './modules/CitationGraph.js';
export { HypothesisGenerator } from './modules/HypothesisGenerator.js';
export { ResourceFeasibilityChecker, RESOURCE_ANCHORS } from './modules/ResourceFeasibilityChecker.js';
export { DocumentArchivist, CATEGORIES as ARCHIVE_CATEGORIES, TAG_PALETTE } from './modules/DocumentArchivist.js';
export { PatentDraftAssistant } from './modules/PatentDraftAssistant.js';

// Tools
export { Tool } from './tools/Tool.js';
export { FileSystemTool } from './tools/FileSystemTool.js';
export { LaTeXDocumentTool } from './tools/LaTeXDocumentTool.js';
export { PlasmaPhysicsTool } from './tools/PlasmaPhysicsTool.js';
export { WebSearchTool } from './tools/WebSearchTool.js';
export { BibliographyTool } from './tools/BibliographyTool.js';
export { ToolRegistry } from './tools/ToolRegistry.js';

// Training
export { TrainingPipeline } from './training/TrainingPipeline.js';

// LLM
export { LLMAdapter } from './llm/LLMAdapter.js';
export { ZAIAdapter } from './llm/ZAIAdapter.js';
export { AnthropicAdapter } from './llm/AnthropicAdapter.js';
export { OpenAIAdapter } from './llm/OpenAIAdapter.js';
export { LocalLLMAdapter } from './llm/LocalLLMAdapter.js';
export { LLMRouter } from './llm/LLMRouter.js';

// Default export: a configured FusionaryAgent factory
import { FusionaryAgent } from './core/FusionaryAgent.js';
import { ZAIAdapter } from './llm/ZAIAdapter.js';
import { LLMRouter } from './llm/LLMRouter.js';

export async function createFusionary(opts = {}) {
  const llm = opts.llm ?? new ZAIAdapter({ model: opts.model ?? 'glm-4.6' });
  const agent = new FusionaryAgent({
    llm,
    researchDir: opts.researchDir ?? './research',
    safetyLevel: opts.safetyLevel ?? 'standard',
    autonomousMode: opts.autonomousMode ?? true,
    maxCycles: opts.maxCycles ?? 50,
    ...opts,
  });
  await agent.init();
  return agent;
}

// If invoked directly, boot the agent
if (import.meta.url === `file://${process.argv[1]}`) {
  const agent = await createFusionary({
    researchDir: process.env.FUSIONARY_RESEARCH_DIR ?? './research',
    maxCycles: parseInt(process.env.FUSIONARY_MAX_CYCLES ?? '50', 10),
  });
  console.log(`
  ╔════════════════════════════════════════════════════════════════════╗
  ║                    FUSIONARY  v1.0  —  online                       ║
  ║   Autonomous Scientific Research Agent for Nuclear Fusion Energy    ║
  ║                                                                    ║
  ║   Mission: practical, safe, short-to-mid-term fusion energy.        ║
  ║   Mode:    autonomous (AJN addiction active)                       ║
  ║   LLM:     ${llm.constructor.name.padEnd(48)}║
  ║   Cycles:  ${agent.maxCycles.toString().padEnd(48)}║
  ║                                                                    ║
  ║   Web UI:  npm run web  →  http://localhost:3000                   ║
  ║   Guide:   npm run guide "<directive>"                             ║
  ╚════════════════════════════════════════════════════════════════════╝
  `);
  process.on('SIGINT', async () => {
    console.log('\n[FUSIONARY] Shutting down...');
    await agent.shutdown();
    process.exit(0);
  });
}
