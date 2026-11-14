import type { EventInput } from '../events.js';
import type { Role } from '../types.js';

export interface AgentTask {
  role: Role;
  /** Display identity. Equals the role except for parallel agents (reviewer:security). */
  agent: string;
  node: string;
  /** System prompt: role definition plus the standards that apply at this tier. */
  instructions: string;
  /** The work order, with all context the agent needs inlined. */
  input: string;
  cwd: string;
  /** none: text in, text out. read: may inspect the workspace. write: may change it. */
  access: 'none' | 'read' | 'write';
  /** Not shown to models. Used by the mock runner and for observability. */
  meta?: Record<string, unknown>;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface AgentResult {
  text: string;
  model: string;
  usage?: Usage;
}

export interface RunnerContext {
  /** Emit an audit event attributed to this agent. */
  emit(event: Pick<EventInput, 'type' | 'data'>): void;
}

export interface AgentRunner {
  readonly name: string;
  readonly kind: string;
  readonly model: string;
  /** True when the runner can read and modify files in `cwd` itself. */
  readonly workspace: boolean;
  run(task: AgentTask, ctx: RunnerContext): Promise<AgentResult>;
}
