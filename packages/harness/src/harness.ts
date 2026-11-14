import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { z } from 'zod';
import { type FoundryConfig, runnerNameFor } from './config.js';
import type { EventInput, EventLog } from './events.js';
import { Git, GitHub } from './git.js';
import { buildInstructions } from './prompts.js';
import type { AgentRunner } from './runners/index.js';
import { formatInstruction, splitReply } from './schemas.js';
import type { DecisionRecord, ReviewLens, Role, Surfaces, Tier } from './types.js';

export interface HarnessOptions {
  projectDir: string;
  runId: string;
  config: FoundryConfig;
  log: EventLog;
  runners: Map<string, AgentRunner>;
  /** Approve every gate without a human. Each auto-approval is still logged with its reason. */
  autoApprove: boolean;
}

export interface InvokeRequest {
  role: Role;
  node: string;
  input: string;
  access: 'none' | 'read' | 'write';
  tier: Tier;
  surfaces: Surfaces;
  lens?: ReviewLens;
  /** Use this runner instead of the one mapped to the role (review ensembles, dispatch). */
  runner?: string;
  /** Distinguishes parallel agents of one role in the log and the viewer (developer@ios). Defaults to the runner name. */
  tag?: string;
  /** Work in this directory instead of the project root (a parallel agent's worktree). */
  cwd?: string;
  /** Set by the scope node, before a tier and surface exist. */
  unscoped?: boolean;
  meta?: Record<string, unknown>;
}

export interface InvokeResult<T> {
  body: string;
  data: T;
  runner: string;
  model: string;
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

/**
 * Drops anything a model says before the document's title ("Here is the PRD...", or a note about
 * a tool it could not use), so chatter never ends up in a committed design document.
 */
export function documentBody(text: string): string {
  const title = text.search(/^# \S/m);
  return title > 0 ? text.slice(title) : text;
}

/** Everything a graph node needs that is not graph state: I/O, agents, git, and the audit log. */
export class Harness {
  readonly projectDir: string;
  readonly runId: string;
  readonly config: FoundryConfig;
  readonly log: EventLog;
  readonly git: Git;
  readonly github: GitHub;
  readonly autoApprove: boolean;
  private readonly runners: Map<string, AgentRunner>;

  constructor(opts: HarnessOptions) {
    this.projectDir = opts.projectDir;
    this.runId = opts.runId;
    this.config = opts.config;
    this.log = opts.log;
    this.runners = opts.runners;
    this.autoApprove = opts.autoApprove;
    this.git = new Git(opts.projectDir);
    this.github = new GitHub(opts.projectDir);
  }

  emit(event: EventInput) {
    return this.log.emit(event);
  }

  runnerFor(role: Role): AgentRunner {
    const name = runnerNameFor(this.config, role);
    const runner = this.runners.get(name);
    if (!runner) throw new Error(`Runner "${name}" is not configured`);
    return runner;
  }

  /** Runs one agent in a fresh context and records its start, activity and outcome. */
  async invoke(request: InvokeRequest): Promise<InvokeResult<undefined>>;
  async invoke<S extends z.ZodType>(request: InvokeRequest, schema: S): Promise<InvokeResult<z.infer<S>>>;
  async invoke<S extends z.ZodType>(request: InvokeRequest, schema?: S): Promise<InvokeResult<unknown>> {
    const runner = request.runner ? this.runners.get(request.runner) : this.runnerFor(request.role);
    if (!runner) throw new Error(`Runner "${request.runner}" is not configured`);
    // Parallel agents sharing a role need distinct identities: reviewer:code@codex, reviewer:code@claude.
    const suffix = request.tag ?? request.runner;
    const agent = `${request.role}${request.lens ? `:${request.lens}` : ''}${suffix ? `@${suffix}` : ''}`;
    const base = { node: request.node, role: request.role, agent };
    const instructions = buildInstructions(request.role, {
      projectDir: this.projectDir,
      tier: request.tier,
      surfaces: request.surfaces,
      ...(request.lens ? { lens: request.lens } : {}),
      ...(request.unscoped ? { unscoped: true } : {}),
    });
    // A runner without workspace access cannot honour read/write; it works from inlined context only.
    const access = runner.workspace ? request.access : 'none';
    const prompt = schema ? `${request.input}\n\n${formatInstruction(schema)}` : request.input;

    let lastError = '';
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const started = Date.now();
      this.emit({ ...base, type: 'agent.started', data: { runner: runner.name, kind: runner.kind, model: runner.model, access, attempt } });
      try {
        const result = await runner.run(
          {
            role: request.role,
            agent,
            node: request.node,
            instructions,
            input: lastError ? `${prompt}\n\nYour previous reply was rejected: ${lastError}\nReply again in full.` : prompt,
            cwd: request.cwd ?? this.projectDir,
            access,
            ...(request.meta ? { meta: request.meta } : {}),
          },
          { emit: (event) => this.emit({ ...base, ...event }) },
        );
        const { body, json } = splitReply(result.text);
        let data: unknown;
        if (schema) {
          if (!json) throw new SyntaxError('the reply did not end with a ```json block');
          data = schema.parse(JSON.parse(json));
        }
        this.emit({
          ...base,
          type: 'agent.finished',
          data: { ok: true, model: result.model, durationMs: Date.now() - started, usage: result.usage ?? {} },
        });
        // Only structured replies carry a document; free-form replies (file blocks, summaries) pass through.
        return { body: schema ? documentBody(body) : result.text.trim(), data, runner: runner.name, model: result.model };
      } catch (error) {
        lastError = (error as Error).message.slice(0, 1500);
        this.emit({ ...base, type: 'agent.finished', data: { ok: false, durationMs: Date.now() - started, error: lastError } });
        // Only malformed output is worth a retry; infrastructure failures surface immediately.
        const malformed = error instanceof SyntaxError || (error as Error).name === 'ZodError';
        if (!malformed || attempt === 2) throw error;
      }
    }
    throw new Error('unreachable');
  }

  /** Writes a project file and records its content hash, so the log proves what was produced. */
  writeArtifact(node: string, relPath: string, content: string): string {
    const target = join(this.projectDir, relPath);
    mkdirSync(dirname(target), { recursive: true });
    const text = content.endsWith('\n') ? content : `${content}\n`;
    writeFileSync(target, text);
    const sha256 = createHash('sha256').update(text).digest('hex');
    this.emit({ type: 'artifact.written', node, data: { path: relPath, sha256, bytes: Buffer.byteLength(text) } });
    return relPath;
  }

  readArtifact(relPath: string | undefined, maxChars = 40_000): string {
    if (!relPath) return '';
    const target = join(this.projectDir, relPath);
    if (!existsSync(target)) return '';
    const text = readFileSync(target, 'utf8');
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n\n[truncated]` : text;
  }

  /** Appends an Architecture Decision Record (MADR layout) and logs it. Returns its path. */
  recordDecision(node: string, role: string, record: DecisionRecord, status = 'Accepted', extra: Record<string, unknown> = {}): string {
    const dir = join(this.projectDir, 'docs', 'decisions');
    mkdirSync(dir, { recursive: true });
    const next = readdirSync(dir).filter((name) => /^\d{4}-/.test(name)).length + 1;
    const id = String(next).padStart(4, '0');
    const relPath = `docs/decisions/${id}-${slug(record.title)}.md`;
    const options = record.options.length
      ? record.options.map((o) => `### ${o.name}\n\n- Good: ${o.pros}\n- Bad: ${o.cons}`).join('\n\n')
      : '_No alternatives were recorded._';
    const content = [
      `# ${id}. ${record.title}`,
      '',
      `- Status: ${status}`,
      `- Date: ${new Date().toISOString().slice(0, 10)}`,
      `- Decided by: ${role} agent, at node \`${node}\``,
      `- Run: \`${this.runId}\``,
      '',
      '## Context',
      '',
      record.context,
      '',
      '## Options considered',
      '',
      options,
      '',
      '## Decision',
      '',
      record.decision,
      '',
      '## Consequences',
      '',
      record.consequences,
    ].join('\n');
    this.writeArtifact(node, relPath, content);
    this.emit({ type: 'decision.recorded', node, role, data: { id, title: record.title, path: relPath, decision: record.decision, ...extra } });
    return relPath;
  }

  commit(node: string, message: string): void {
    const sha = this.git.commitAll(message, { 'Foundry-Run': this.runId, 'Foundry-Node': node });
    if (sha) this.emit({ type: 'git.commit', node, data: { sha, message } });
  }
}
