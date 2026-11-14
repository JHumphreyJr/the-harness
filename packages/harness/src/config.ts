import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { ROLES, type Role } from './types.js';

const RunnerSpec = z.discriminatedUnion('type', [
  z.object({
    /** Claude Agent SDK: a full coding agent (files, shell, search) with hook-level auditing and policy. */
    type: z.literal('claude-agent-sdk'),
    model: z.string().optional(),
    maxTurns: z.number().int().positive().default(60),
  }),
  z.object({
    /** Any coding-agent CLI that takes a prompt and edits the working directory (Codex, Gemini CLI, OpenCode, ...). */
    type: z.literal('cli'),
    /** argv. `{prompt}` is replaced with the full prompt; omit it and set promptVia: stdin to pipe instead. */
    command: z.array(z.string()).min(1),
    promptVia: z.enum(['arg', 'stdin']).default('arg'),
    model: z.string().default('external-cli'),
    timeoutSec: z.number().int().positive().default(1800),
  }),
  z.object({
    /** Any chat model LangChain can initialise ("openai:gpt-...", "anthropic:claude-...", "ollama:..."). No workspace access. */
    type: z.literal('chat'),
    model: z.string(),
    temperature: z.number().min(0).max(2).optional(),
  }),
  z.object({
    /** Deterministic offline runner used by tests and `foundry demo`. */
    type: z.literal('mock'),
    stepMs: z.number().int().nonnegative().default(0),
  }),
]);
export type RunnerSpec = z.infer<typeof RunnerSpec>;

const roleKeys = Object.fromEntries(ROLES.map((r) => [r, z.string().optional()])) as Record<
  Role,
  z.ZodOptional<z.ZodString>
>;

export const ConfigSchema = z.object({
  runners: z.record(z.string(), RunnerSpec).default({ claude: { type: 'claude-agent-sdk', maxTurns: 60 } }),
  roles: z.object({ default: z.string().default('claude'), ...roleKeys }).default({ default: 'claude' }),
  verify: z
    .object({
      /** Shell commands that must all exit 0. Leave empty to auto-detect: scripts/verify.sh, Cargo.toml, Package.swift, package.json. */
      commands: z.array(z.string()).default([]),
      timeoutSec: z.number().int().positive().default(900),
    })
    .default({ commands: [], timeoutSec: 900 }),
  github: z
    .object({
      openPullRequest: z.boolean().default(true),
      draft: z.boolean().default(true),
      postReviews: z.boolean().default(true),
    })
    .default({ openPullRequest: true, draft: true, postReviews: true }),
  review: z
    .object({
      /** Characters of diff sent to reviewers that cannot read the workspace themselves. */
      maxDiffChars: z.number().int().positive().default(120_000),
      /**
       * Runner names that each review every lens, in parallel. Use two vendors for independent
       * second opinions. Empty means the single runner mapped to the reviewer role.
       */
      ensemble: z.array(z.string()).default([]),
    })
    .default({ maxDiffChars: 120_000, ensemble: [] }),
  dispatch: z
    .object({
      /** Most developer agents working at once. Each parallel agent gets its own git worktree. */
      maxParallel: z.number().int().min(1).max(8).default(3),
      /** Runner per task size for the developer role. High-risk tasks are treated as large. */
      bySize: z.object({ small: z.string().optional(), medium: z.string().optional(), large: z.string().optional() }).default({}),
      /** Runner per track, for example { ios: claude, web: codex-dev }. Wins over bySize. */
      byTrack: z.record(z.string(), z.string()).default({}),
    })
    .default({ maxParallel: 3, bySize: {}, byTrack: {} }),
  approver: z.string().default(process.env.USER ?? 'operator'),
});
export type FoundryConfig = z.infer<typeof ConfigSchema>;

export const CONFIG_FILE = 'foundry.config.yaml';

export function loadConfig(projectDir: string, overrides: Partial<FoundryConfig> = {}): FoundryConfig {
  const file = join(projectDir, CONFIG_FILE);
  const raw = existsSync(file) ? (parse(readFileSync(file, 'utf8')) ?? {}) : {};
  const config = ConfigSchema.parse({ ...raw, ...overrides });
  validateConfig(config);
  return config;
}

export function runnerNameFor(config: FoundryConfig, role: Role): string {
  return config.roles[role] ?? config.roles.default;
}

/** Fail at startup, not three stages in, when the role mapping cannot work. */
export function validateConfig(config: FoundryConfig): void {
  for (const name of config.review.ensemble) {
    if (!config.runners[name]) throw new Error(`review.ensemble names runner "${name}", which is not defined under runners.`);
  }
  const routed = [...Object.values(config.dispatch.byTrack), ...Object.values(config.dispatch.bySize).filter((name): name is string => Boolean(name))];
  for (const name of routed) {
    const spec = config.runners[name];
    if (!spec) throw new Error(`dispatch names runner "${name}", which is not defined under runners.`);
    if (spec.type === 'chat') throw new Error(`dispatch routes developer work to "${name}", a chat runner with no workspace access.`);
  }
  for (const role of ROLES) {
    const name = runnerNameFor(config, role);
    const spec = config.runners[name];
    if (!spec) throw new Error(`Role "${role}" is mapped to runner "${name}", which is not defined under runners.`);
    if (role === 'developer' && spec.type === 'chat') {
      throw new Error(
        `Role "developer" needs a runner with workspace access (claude-agent-sdk or cli); "${name}" is a chat runner.`,
      );
    }
  }
}

export function reviewRunners(config: FoundryConfig): string[] {
  return config.review.ensemble.length ? config.review.ensemble : [runnerNameFor(config, 'reviewer')];
}

/** Independent review is stronger when the reviewer is not the same model that wrote the code. */
export function reviewIndependence(config: FoundryConfig): { independent: boolean; note: string } {
  const id = (s: RunnerSpec | undefined) => (s ? `${s.type}:${'model' in s ? (s.model ?? 'default') : 'mock'}` : '');
  const dev = id(config.runners[runnerNameFor(config, 'developer')]);
  const reviewers = reviewRunners(config).map((name) => id(config.runners[name]));
  const independent = reviewers.some((reviewer) => reviewer !== dev);
  return {
    independent,
    note: independent
      ? `Review is independent of the developer: ${reviewers.length} reviewer runner(s) per lens, at least one on a different model.`
      : 'Reviewer and developer use the same model. Reviews still run in a fresh context, but a different model catches more.',
  };
}
