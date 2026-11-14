#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Command } from 'commander';
import { CONFIG_FILE, loadConfig } from './config.js';
import { readEvents, verifyChain, type AuditEvent } from './events.js';
import { fileGate } from './gates.js';
import type { GateRequest } from './graph.js';
import { ASSETS_DIR } from './prompts.js';
import { startBridge } from './bridge.js';
import { VERSION, eventsFile, executeRun, listRuns } from './run.js';
import { TIERS, type GateDecision, type Tier } from './types.js';
import { TIER_PROFILES } from './tiers.js';

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const amber = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

function describe(event: AuditEvent): string | null {
  const d = (event.data ?? {}) as Record<string, any>;
  const who = event.agent ?? event.role ?? '';
  switch (event.type) {
    case 'node.entered':
      return bold(`\n▸ ${event.node}`);
    case 'agent.started':
      return dim(`  ${who} started (${d.model})`);
    case 'agent.tool':
      return dim(`  ${who} · ${d.tool} ${d.detail ?? ''}`);
    case 'artifact.written':
      return `  wrote ${d.path}`;
    case 'decision.recorded':
      return `  decision ${d.id}: ${d.title}`;
    case 'verify.result':
      return d.ok ? green('  checks passed') : red('  checks failed');
    case 'review.verdict':
      return `  ${d.lens} review: ${d.verdict === 'approve' ? green('approved') : amber('changes requested')} (${d.findings} findings)`;
    case 'policy.denied':
      return red(`  blocked ${d.tool}: ${d.reason}`);
    case 'pr.opened':
      return `  pull request ${d.url}`;
    case 'gate.resolved':
      return d.by === 'policy' ? dim(`  gate ${d.gate}: auto-approved (${d.reason})`) : null;
    default:
      return null;
  }
}

async function promptGate(request: GateRequest, approver: string): Promise<GateDecision> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`\n${amber('■ Waiting on you:')} ${bold(request.title)}\n${request.summary}`);
    for (const path of request.artifacts.filter(Boolean)) console.log(dim(`  read: ${path}`));

    if (request.gate === 'clarify') {
      const answers: Record<string, string> = {};
      for (const [index, q] of (request.questions ?? []).entries()) {
        console.log(`\n${index + 1}. ${q.question}\n${dim(`   Why: ${q.why}\n   If blank: ${q.assumption}`)}`);
        answers[String(index)] = await rl.question('   > ');
      }
      return { decision: 'approve', answers, by: approver };
    }

    const tierHint = request.gate === 'scope' ? `, or a tier (${TIERS.join(' | ')})` : '';
    for (;;) {
      const reply = (await rl.question(`\n[a]pprove, [r]evise${tierHint}: `)).trim();
      if (/^a(pprove)?$/i.test(reply)) return { decision: 'approve', by: approver };
      if (request.gate === 'scope' && (TIERS as readonly string[]).includes(reply)) {
        return { decision: 'approve', answers: { tier: reply }, by: approver };
      }
      if (/^r(evise)?$/i.test(reply)) {
        const feedback = await rl.question('What should change? ');
        return { decision: 'revise', feedback, by: approver };
      }
    }
  } finally {
    rl.close();
  }
}

const autoGate = async (request: GateRequest): Promise<GateDecision> => ({ decision: 'approve', by: `auto (${request.gate})` });

async function runCommand(request: string | undefined, flags: { project: string; tier?: string; autoApprove?: boolean; mock?: boolean; resume?: string; viewer?: boolean; port: string; quiet?: boolean; gates?: string; replan?: string | boolean }) {
  const projectDir = resolve(flags.project);
  if (flags.tier && !(TIERS as readonly string[]).includes(flags.tier)) throw new Error(`Unknown tier "${flags.tier}". Use one of: ${TIERS.join(', ')}`);
  const approver = flags.mock ? 'demo' : loadConfig(projectDir).approver;
  const bridge = flags.viewer ? await startBridge({ projectDir, port: Number(flags.port) }) : null;
  if (bridge) console.log(`Viewer: ${bridge.url}`);
  const outcome = await executeRun({
    projectDir,
    ...(request ? { request } : {}),
    ...(flags.tier ? { tier: flags.tier as Tier } : {}),
    ...(flags.resume ? { resumeRunId: flags.resume } : {}),
    ...(flags.resume && flags.replan !== undefined ? { replan: flags.replan === true ? '' : String(flags.replan) } : {}),
    autoApprove: Boolean(flags.autoApprove),
    mock: Boolean(flags.mock),
    onGate: flags.autoApprove
      ? autoGate
      : flags.gates === 'file'
        ? (req, _state, run) => {
            console.log(`\n${amber('■ Waiting on a gate response file:')} ${bold(req.title)}`);
            return fileGate(req, run, { log: (line) => console.log(dim(`  ${line}`)) });
          }
        : (req) => promptGate(req, approver),
    onEvent: (event) => {
      const line = flags.quiet ? null : describe(event);
      if (line) console.log(line);
    },
  });
  const { state, usage } = outcome;
  console.log(`\n${state.unresolved.length ? amber('Finished with unresolved items') : green('Finished')}: run ${outcome.runId}`);
  console.log(`  branch   ${state.branch}${state.prUrl ? `\n  PR       ${state.prUrl}` : ''}`);
  console.log(`  report   docs/runs/${outcome.runId}.md`);
  console.log(`  tokens   ${usage.inputTokens} in / ${usage.outputTokens} out${usage.costUsd ? `, about $${usage.costUsd.toFixed(2)}` : ''}`);
  for (const item of state.unresolved) console.log(amber(`  unresolved: ${item}`));
  if (bridge) console.log(dim('The viewer stays up for replay. Ctrl+C to exit.'));
}

const program = new Command('foundry').description('Graph-orchestrated, tier-aware multi-agent software harness').version(VERSION);

program
  .command('run')
  .argument('[request]', 'what to build, in plain language (or a path to a file containing it)')
  .option('-p, --project <dir>', 'target project directory', '.')
  .option('-t, --tier <tier>', `fix the scale tier: ${TIERS.join(' | ')}`)
  .option('--auto-approve', 'approve every gate without asking (logged as such)')
  .option('--mock', 'use the offline mock runner instead of real models')
  .option('--viewer', 'also serve the 3D viewer for this project')
  .option('--port <port>', 'viewer port', '4317')
  .option('--quiet', 'print only gates and the final summary')
  .option('--gates <mode>', 'where gates are answered: terminal, or file (JSON files under .foundry/runs/<id>/gates)', 'terminal')
  .action(async (request: string | undefined, flags) => {
    const text = request && existsSync(request) ? readFileSync(request, 'utf8') : request;
    await runCommand(text, flags);
  });

program
  .command('resume')
  .argument('<runId>')
  .option('-p, --project <dir>', 'target project directory', '.')
  .option('--auto-approve', 'approve every remaining gate without asking')
  .option('--viewer', 'also serve the 3D viewer for this project')
  .option('--replan [note]', 'discard the remaining plan and plan again from the approved designs; the note goes to the planner')
  .option('--gates <mode>', 'where gates are answered: terminal, or file (JSON files under .foundry/runs/<id>/gates)', 'terminal')
  .option('--port <port>', 'viewer port', '4317')
  .action((runId: string, flags) => runCommand(undefined, { ...flags, resume: runId }));

program
  .command('runs')
  .option('-p, --project <dir>', 'target project directory', '.')
  .action((flags) => {
    for (const run of listRuns(resolve(flags.project))) console.log(`${run.runId}  ${(run.tier ?? 'tier: auto').padEnd(17)} ${run.request.split('\n')[0]?.slice(0, 70)}`);
  });

program
  .command('tiers')
  .description('show what each scale tier requires')
  .action(() => {
    for (const p of Object.values(TIER_PROFILES)) {
      console.log(`${bold(p.tier)}  ${p.label}\n  ${p.intent}\n  human gates: ${p.gates.join(', ')}\n  review lenses: ${p.reviewLenses.join(', ')} | threat model: ${p.stages.threatModel ? 'yes' : 'no'}\n`);
    }
  });

const audit = program.command('audit').description('inspect and verify the audit trail');

audit
  .command('verify')
  .argument('<runIdOrFile>', 'a run id, or a path to an exported .events.jsonl')
  .option('-p, --project <dir>', 'target project directory', '.')
  .action((target: string, flags) => {
    const file = existsSync(target) ? target : eventsFile(resolve(flags.project), target);
    const report = verifyChain(readEvents(file));
    if (report.ok) console.log(green(`OK  ${report.count} events, chain intact\nhead ${report.head}`));
    else {
      console.log(red(`TAMPERED OR CORRUPT at seq ${report.brokenAt}: ${report.reason}`));
      process.exitCode = 1;
    }
  });

audit
  .command('show')
  .argument('<runId>')
  .option('-p, --project <dir>', 'target project directory', '.')
  .option('--type <prefix>', 'only events whose type starts with this, e.g. gate, decision, review')
  .option('--json', 'raw JSON lines')
  .action((runId: string, flags) => {
    for (const event of readEvents(eventsFile(resolve(flags.project), runId))) {
      if (flags.type && !event.type.startsWith(flags.type)) continue;
      if (flags.json) console.log(JSON.stringify(event));
      else console.log(`${String(event.seq).padStart(4)}  ${event.ts.slice(11, 19)}  ${event.type.padEnd(18)} ${(event.agent ?? event.node ?? '').padEnd(20)} ${JSON.stringify(event.data).slice(0, 110)}`);
    }
  });

program
  .command('viewer')
  .description('serve the 3D viewer for a project and attach to its runs')
  .option('-p, --project <dir>', 'target project directory', '.')
  .option('--port <port>', 'port', '4317')
  .action(async (flags) => {
    const bridge = await startBridge({ projectDir: resolve(flags.project), port: Number(flags.port) });
    console.log(`Viewer: ${bridge.url}  (Ctrl+C to stop; runs are unaffected)`);
  });

program
  .command('init')
  .description('add Foundry configuration and the CI review workflow to a project')
  .argument('[dir]', 'project directory', '.')
  .action((dir: string) => {
    const projectDir = resolve(dir);
    const templates = join(ASSETS_DIR, 'templates');
    const copies: [string, string][] = [
      ['foundry.config.yaml', CONFIG_FILE],
      ['github/workflows/ai-review.yml', '.github/workflows/ai-review.yml'],
      ['github/pull_request_template.md', '.github/pull_request_template.md'],
    ];
    for (const [from, to] of copies) {
      const target = join(projectDir, to);
      if (existsSync(target)) {
        console.log(dim(`kept    ${to}`));
        continue;
      }
      mkdirSync(join(target, '..'), { recursive: true });
      cpSync(join(templates, from), target);
      console.log(`created ${to}`);
    }
    console.log(`\nNext: edit ${CONFIG_FILE}, then: foundry run "what you want built" --project ${dir}`);
  });

program
  .command('demo')
  .description('run the whole workflow offline with mock agents and open the 3D viewer')
  .option('--port <port>', 'viewer port', '4317')
  .option('--step <ms>', 'delay between simulated agent actions', '700')
  .action(async (flags) => {
    const projectDir = mkdtempSync(join(tmpdir(), 'foundry-demo-'));
    writeFileSync(join(projectDir, 'README.md'), '# Demo project\n');
    const bridge = await startBridge({ projectDir, port: Number(flags.port) });
    console.log(`Demo project: ${projectDir}\n${bold(`Open ${bridge.url}`)} to watch. Starting in 3 seconds.`);
    await new Promise((r) => setTimeout(r, 3000));
    const outcome = await executeRun({
      projectDir,
      request: 'A phone-first web app where club members log outings and organisers review the month.',
      autoApprove: true,
      mock: true,
      mockStepMs: Number(flags.step),
      onGate: autoGate,
      onEvent: (event) => {
        const line = describe(event);
        if (line) console.log(line);
      },
    });
    console.log(`\n${green('Demo finished.')} Run ${outcome.runId}. The viewer stays up for replay; Ctrl+C to exit.`);
  });

program.parseAsync().catch((error: Error) => {
  console.error(red(`\nfoundry: ${error.message}`));
  process.exit(1);
});
