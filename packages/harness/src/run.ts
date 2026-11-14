import { randomBytes } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from '@langchain/langgraph';
import { FileCheckpointSaver } from './checkpoint.js';
import { type FoundryConfig, loadConfig, runnerNameFor } from './config.js';
import { EventLog, readEvents, type AuditEvent } from './events.js';
import { Git } from './git.js';
import { buildGraph, type GateRequest, type State } from './graph.js';
import { Harness } from './harness.js';
import { createRunners } from './runners/index.js';
import { TOPOLOGY } from './topology.js';
import { ROLES, type GateDecision, type Tier } from './types.js';

export const VERSION = '0.1.0';

export interface RunMeta {
  runId: string;
  request: string;
  tier: Tier | null;
  createdAt: string;
  autoApprove: boolean;
  mock: boolean;
}

export interface RunOptions {
  projectDir: string;
  /** Required for a new run; ignored on resume. */
  request?: string;
  tier?: Tier;
  /** Resume this run instead of starting a new one. */
  resumeRunId?: string;
  /** With resumeRunId: discard the remaining plan and plan again from the approved designs, with this note to the planner. */
  replan?: string;
  autoApprove?: boolean;
  /** Use the offline mock runner for every role. */
  mock?: boolean;
  mockStepMs?: number;
  onGate: (request: GateRequest, state: State, run: { runId: string; projectDir: string }) => Promise<GateDecision>;
  onEvent?: (event: AuditEvent) => void;
}

export interface RunOutcome {
  runId: string;
  state: State;
  eventsFile: string;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}

export const runsDir = (projectDir: string) => join(projectDir, '.foundry', 'runs');
export const eventsFile = (projectDir: string, runId: string) => join(runsDir(projectDir), runId, 'events.jsonl');

export function newRunId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `${stamp.slice(0, 8)}-${stamp.slice(8)}-${randomBytes(2).toString('hex')}`;
}

export function listRuns(projectDir: string): RunMeta[] {
  const dir = runsDir(projectDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((id) => join(dir, id, 'run.json'))
    .filter((file) => existsSync(file))
    .map((file) => JSON.parse(readFileSync(file, 'utf8')) as RunMeta)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const IGNORES = ['.foundry/runs/', '.foundry/worktrees/'];

function ensureIgnored(projectDir: string): void {
  const file = join(projectDir, '.gitignore');
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const missing = IGNORES.filter((entry) => !current.split('\n').includes(entry));
  if (missing.length) appendFileSync(file, `${current && !current.endsWith('\n') ? '\n' : ''}# Foundry working state (the audit log is exported to docs/runs/)\n${missing.join('\n')}\n`);
}

function mockConfig(stepMs: number): Partial<FoundryConfig> {
  return {
    runners: { mock: { type: 'mock', stepMs } },
    roles: { default: 'mock' },
    verify: { commands: ['node -e "process.exit(0)"'], timeoutSec: 60 },
    github: { openPullRequest: false, draft: true, postReviews: false },
  };
}

export async function executeRun(opts: RunOptions): Promise<RunOutcome> {
  const { projectDir } = opts;
  const resuming = Boolean(opts.resumeRunId);
  const runId = opts.resumeRunId ?? newRunId();
  const dir = join(runsDir(projectDir), runId);
  const metaFile = join(dir, 'run.json');

  let meta: RunMeta;
  if (resuming) {
    if (!existsSync(metaFile)) throw new Error(`No run "${runId}" in ${projectDir}`);
    meta = JSON.parse(readFileSync(metaFile, 'utf8')) as RunMeta;
  } else {
    if (!opts.request?.trim()) throw new Error('A request is required to start a run.');
    const git = new Git(projectDir);
    mkdirSync(projectDir, { recursive: true });
    // Uncommitted work would be swept into the run branch by the first harness commit.
    // The harness's own .gitignore entry is exempt: it is committed just below, and an earlier
    // failed run may have left it behind.
    const dirty = existsSync(join(projectDir, '.git')) ? git.dirtyPaths().filter((path) => path !== '.gitignore') : [];
    if (dirty.length) {
      throw new Error(`The working tree has uncommitted changes. Commit or stash them before starting a run:\n  ${dirty.slice(0, 10).join('\n  ')}`);
    }
    ensureIgnored(projectDir);
    // Commit the ignore rule now. Left uncommitted, a run that fails early would leave the tree
    // dirty and block the next attempt.
    git.ensureRepo();
    git.commitPaths(['.gitignore'], 'chore: ignore foundry working state');
    meta = { runId, request: opts.request.trim(), tier: opts.tier ?? null, createdAt: new Date().toISOString(), autoApprove: Boolean(opts.autoApprove), mock: Boolean(opts.mock) };
    mkdirSync(dir, { recursive: true });
    writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
  }

  const config = loadConfig(projectDir, meta.mock ? mockConfig(opts.mockStepMs ?? 0) : {});
  const log = new EventLog(eventsFile(projectDir, runId), runId);
  if (opts.onEvent) log.subscribe(opts.onEvent);
  const harness = new Harness({ projectDir, runId, config, log, runners: createRunners(config), autoApprove: meta.autoApprove });
  const graph = buildGraph(harness, new FileCheckpointSaver(join(dir, 'checkpoint.json')));
  const thread = { configurable: { thread_id: runId }, recursionLimit: 1000 };

  if (!resuming) {
    log.emit({
      type: 'run.started',
      data: {
        request: meta.request,
        tier: meta.tier,
        autoApprove: meta.autoApprove,
        harnessVersion: VERSION,
        roles: Object.fromEntries(
          ROLES.map((role) => {
            const runner = harness.runnerFor(role);
            return [role, { runner: runnerNameFor(config, role), kind: runner.kind, model: runner.model }];
          }),
        ),
        topology: TOPOLOGY,
      },
    });
  }

  if (resuming) {
    // An interrupted agent may have left half-finished files. Keep them, on the record, before continuing.
    const sha = harness.git.commitAll(`wip: work in progress when run ${runId} was interrupted`, { 'Foundry-Run': runId, 'Foundry-Node': 'resume' });
    if (sha) log.emit({ type: 'git.commit', node: 'intake', data: { sha, message: 'work in progress preserved on resume' } });
  }
  if (resuming && opts.replan !== undefined) {
    // Re-enter the graph as if the last design gate had just been approved, so planning runs again.
    await graph.updateState(
      thread,
      { tasks: [], done: [], wave: [], serial: [], checks: null, verifyAttempts: 0, phase: 'build', stage: 'qa', unresolved: [], feedback: { plan: opts.replan || 'The plan is being rebuilt for parallel tracks.' } } as never,
      'gate_threat-model',
    );
    log.emit({ type: 'agent.message', node: 'plan', data: { text: `Re-planning requested by the operator: ${opts.replan || 'no note given'}`, replan: true } });
  }

  try {
    let input: unknown = resuming ? null : { request: meta.request, ...(meta.tier ? { tier: meta.tier, tierPinned: true } : { tierPinned: false }) };
    for (;;) {
      if (input !== undefined) {
        const stream = await graph.stream(input as never, { ...thread, streamMode: 'updates' });
        for await (const _ of stream) void _;
      }
      const snapshot = await graph.getState(thread);
      const pending = snapshot.tasks.flatMap((task) => task.interrupts.map((i) => ({ node: task.name, request: i.value as GateRequest })));
      const next = pending[0];
      if (!next) {
        if (snapshot.next.length === 0) break;
        input = null; // Crash recovery: no gate is waiting, so continue from the last checkpoint.
        continue;
      }
      log.emit({ type: 'gate.requested', node: next.node, data: { gate: next.request.gate, title: next.request.title, summary: next.request.summary, artifacts: next.request.artifacts } });
      const decision = await opts.onGate(next.request, snapshot.values as State, { runId, projectDir });
      log.emit({ type: 'gate.resolved', node: next.node, data: { gate: next.request.gate, decision: decision.decision, by: decision.by, feedback: decision.feedback ?? '', answers: decision.answers ?? {} } });
      input = new Command({ resume: decision });
    }

    const state = (await graph.getState(thread)).values as State;
    const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    for (const event of readEvents(log.file)) {
      if (event.type !== 'agent.finished') continue;
      const u = (event.data?.usage ?? {}) as { inputTokens?: number; outputTokens?: number; costUsd?: number };
      usage.inputTokens += u.inputTokens ?? 0;
      usage.outputTokens += u.outputTokens ?? 0;
      usage.costUsd += u.costUsd ?? 0;
    }
    log.emit({ type: 'run.completed', data: { unresolved: state.unresolved, prUrl: state.prUrl, branch: state.branch, usage } });

    // Export the finished, verifiable log into the repository so the audit trail travels with the PR.
    // Committed directly (not through the harness) so the export is not followed by further events.
    const exported = join(projectDir, 'docs', 'runs', `${runId}.events.jsonl`);
    mkdirSync(join(projectDir, 'docs', 'runs'), { recursive: true });
    copyFileSync(log.file, exported);
    harness.git.commitAll(`docs(run): report and audit trail for ${runId}`, { 'Foundry-Run': runId, 'Foundry-Node': 'complete' });
    if (state.prUrl) harness.git.push(state.branch);

    return { runId, state, eventsFile: log.file, usage };
  } catch (error) {
    log.emit({ type: 'run.failed', data: { error: (error as Error).message.slice(0, 2000) } });
    // Keep whatever the run produced, and leave a clean tree so the run can be resumed or restarted.
    let hint = '';
    try {
      const sha = harness.git.commitAll(`wip: run ${runId} stopped on an error`, { 'Foundry-Run': runId, 'Foundry-Node': 'failed' });
      const base = ((await graph.getState(thread)).values as Partial<State>).baseBranch;
      hint = `\n  Work so far is ${sha ? `committed (${sha})` : 'unchanged'} on this run's branch. Continue with: foundry resume ${runId}${base ? `\n  Or start over from where you began: git checkout ${base}` : ''}`;
    } catch {
      // Reporting the original failure matters more than tidying up after it.
    }
    (error as Error).message += hint;
    throw error;
  }
}
