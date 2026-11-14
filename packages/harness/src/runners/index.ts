import type { FoundryConfig, RunnerSpec } from '../config.js';
import { ChatModelRunner } from './chat.js';
import { ClaudeAgentRunner } from './claude.js';
import { CliAgentRunner } from './cli.js';
import { MockRunner } from './mock.js';
import type { AgentRunner } from './types.js';

export function createRunner(name: string, spec: RunnerSpec): AgentRunner {
  switch (spec.type) {
    case 'claude-agent-sdk':
      return new ClaudeAgentRunner(name, spec);
    case 'cli':
      return new CliAgentRunner(name, spec);
    case 'chat':
      return new ChatModelRunner(name, spec);
    case 'mock':
      return new MockRunner(name, spec);
  }
}

export function createRunners(config: FoundryConfig): Map<string, AgentRunner> {
  return new Map(Object.entries(config.runners).map(([name, spec]) => [name, createRunner(name, spec)]));
}

export type { AgentRunner, AgentResult, AgentTask, RunnerContext } from './types.js';
