#!/usr/bin/env node
/**
 * FUSIONARY CLI — v1.0
 *
 * Commands:
 *   research            Run autonomous research (default)
 *   guide "<directive>" Send an owner directive to the running agent
 *   web                 Start the web dashboard
 *   demo                Run a 3-cycle demo
 *   train               Run the 4-phase training pipeline
 *   checkpoint save|list|load
 *   patents             List patent-eligible documents
 *   archive             Rebuild archive indices
 *   status              Print agent status snapshot
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { createFusionary } from '../src/index.js';
import { StateSerializer } from '../src/core/StateSerializer.js';

const program = new Command();

program
  .name('fusionary')
  .description('FUSIONARY v1.0 — Autonomous Scientific Research Agent for Nuclear Fusion Energy')
  .version('1.0.0');

program
  .command('research')
  .description('Run autonomous research (default mode)')
  .option('-c, --cycles <n>', 'maximum cycles', '50')
  .option('-s, --safety <level>', 'safety level (permissive|standard|strict)', 'standard')
  .option('--no-autonomous', 'wait for explicit owner directives')
  .action(async (opts) => {
    const spinner = ora('Initialising FUSIONARY...').start();
    const agent = await createFusionary({
      maxCycles: parseInt(opts.cycles, 10),
      safetyLevel: opts.safety,
      autonomousMode: opts.autonomous !== false,
    });
    spinner.succeed(`FUSIONARY online — agent ${agent.id}`);
    console.log(chalk.cyan('\n  Research topic: Practical, safe, short-to-mid-term nuclear fusion energy.'));
    console.log(chalk.gray('  Press Ctrl+C to stop.\n'));

    agent.on('cycle:start', ({ count }) => {
      console.log(chalk.blue(`\n[Cycle ${count}] starting...`));
    });
    agent.on('hypothesis:generated', (h) => {
      console.log(chalk.green('  ✓ Hypothesis generated:'));
      console.log(chalk.white(`    ${h.statement?.slice(0, 120) ?? '(no statement)'}`));
      console.log(chalk.gray(`    Feasibility: ${h.feasibility?.tier ?? 'unknown'}`));
    });
    agent.on('patent:drafted', (p) => {
      console.log(chalk.magenta('  ✓ Patent draft:'));
      console.log(chalk.white(`    ${p.title}`));
      console.log(chalk.gray(`    ${p.claims?.length ?? 0} claims`));
    });
    agent.on('document:archived', (r) => {
      console.log(chalk.gray(`  → Archived: ${r.manifest.category}/${r.manifest.topic}/${r.manifest.id}`));
    });
    agent.on('cycle:error', ({ error }) => {
      console.log(chalk.red(`  ✗ Cycle error: ${error}`));
    });

    // Keep process alive
    setInterval(() => {}, 1000);
  });

program
  .command('guide <directive>')
  .description('Send an owner directive to the running agent')
  .action(async (directive) => {
    // For simplicity, we boot a fresh agent and apply the directive immediately.
    // In a production setup, this would POST to the running web server.
    const agent = await createFusionary({ maxCycles: 5 });
    console.log(chalk.cyan(`Sending directive: "${directive}"`));
    const r = await agent.guide(directive);
    console.log(chalk.green('Directive accepted:'));
    console.log(JSON.stringify(r, null, 2));
    await agent.shutdown();
    process.exit(0);
  });

program
  .command('web')
  .description('Start the web dashboard (port 3000)')
  .action(async () => {
    await import('../web/server.js');
  });

program
  .command('demo')
  .description('Run a 3-cycle demo')
  .action(async () => {
    const spinner = ora('Booting FUSIONARY demo...').start();
    const agent = await createFusionary({ maxCycles: 3, autonomousMode: false });
    spinner.succeed('Demo ready');
    for (let i = 0; i < 3; i++) {
      console.log(chalk.blue(`\n=== Demo cycle ${i + 1} ===`));
      await agent._runCycle();
    }
    const stats = agent.archivist.stats();
    console.log(chalk.green('\n=== Demo complete ==='));
    console.log(chalk.white(`  Documents produced: ${stats.total}`));
    console.log(chalk.white(`  Patent-eligible: ${stats.patentEligible}`));
    await agent.shutdown();
    process.exit(0);
  });

program
  .command('train')
  .description('Run the 4-phase training pipeline')
  .action(async () => {
    const agent = await createFusionary({ autonomousMode: false });
    const { TrainingPipeline } = await import('../src/training/TrainingPipeline.js');
    const pipeline = new TrainingPipeline({ agent });
    await pipeline.run();
    await agent.shutdown();
    process.exit(0);
  });

program
  .command('checkpoint <action>')
  .description('save | list | load a checkpoint')
  .option('--label <label>', 'checkpoint label')
  .option('--id <id>', 'checkpoint id')
  .action(async (action, opts) => {
    const agent = await createFusionary({ autonomousMode: false });
    const serializer = new StateSerializer({});
    if (action === 'save') {
      const r = await serializer.save(agent, opts.label ?? 'manual');
      console.log(chalk.green(`Saved: ${r.filepath}`));
    } else if (action === 'list') {
      const list = serializer.list();
      console.log(chalk.cyan(`Checkpoints (${list.length}):`));
      for (const c of list) console.log(`  ${c.timestamp}  ${c.label}`);
    } else if (action === 'load') {
      const r = await serializer.load(agent, opts.id ?? opts.label);
      if (r) console.log(chalk.green(`Loaded: ${r.label}`));
      else console.log(chalk.red('Not found'));
    } else {
      console.log(chalk.red(`Unknown action: ${action}`));
    }
    await agent.shutdown();
    process.exit(0);
  });

program
  .command('patents')
  .description('List patent-eligible documents')
  .action(async () => {
    const agent = await createFusionary({ autonomousMode: false });
    const queue = agent.archivist.patentQueue();
    if (queue.length === 0) {
      console.log(chalk.yellow('No patent-eligible documents yet.'));
    } else {
      console.log(chalk.cyan(`Patent queue (${queue.length}):`));
      for (const r of queue) {
        const m = r.manifest;
        console.log(chalk.white(`  ${m.title}`));
        console.log(chalk.gray(`    ${m.category}/${m.topic}/${m.id} — ${(m.patent.claims ?? []).length} claims`));
      }
    }
    await agent.shutdown();
    process.exit(0);
  });

program
  .command('archive')
  .description('Rebuild archive indices')
  .action(async () => {
    const agent = await createFusionary({ autonomousMode: false });
    const r = agent.archivist.rebuildIndices();
    console.log(chalk.green(`Rebuilt: ${r.total} documents, ${r.patents} patent-eligible.`));
    await agent.shutdown();
    process.exit(0);
  });

program
  .command('status')
  .description('Print agent status snapshot')
  .action(async () => {
    const agent = await createFusionary({ autonomousMode: false });
    console.log(JSON.stringify(agent.status(), null, 2));
    await agent.shutdown();
    process.exit(0);
  });

program.parse(process.argv);
