import { spawn } from 'node:child_process';
import type { AgentResult, AgentRunner, AgentTask, RunnerContext } from './types.js';

/**
 * Adapter for any coding-agent CLI. This is the model-agnostic path for roles that must
 * edit the workspace: the CLI supplies its own model, tools and sandbox.
 *
 * The harness cannot see inside the CLI, so the audit trail records its stdout and the
 * resulting git diff, not individual tool calls. Run untrusted CLIs in a container.
 */
export class CliAgentRunner implements AgentRunner {
  readonly kind = 'cli';
  readonly workspace = true;
  readonly model: string;

  constructor(
    readonly name: string,
    private readonly opts: { command: string[]; promptVia: 'arg' | 'stdin'; model: string; timeoutSec: number },
  ) {
    this.model = opts.model;
  }

  run(task: AgentTask, ctx: RunnerContext): Promise<AgentResult> {
    const prompt = `${task.instructions}\n\n---\n\n${task.input}`;
    const [bin, ...rest] = this.opts.command as [string, ...string[]];
    const args = rest.map((arg) => (this.opts.promptVia === 'arg' ? arg.replaceAll('{prompt}', prompt) : arg));

    return new Promise((resolve, reject) => {
      // No shell: the prompt is passed as a single argv entry and is never interpreted.
      const child = spawn(bin, args, { cwd: task.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => child.kill('SIGTERM'), this.opts.timeoutSec * 1000);

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        const line = text.trim().split('\n').at(-1);
        if (line) ctx.emit({ type: 'agent.message', data: { text: line.slice(0, 400) } });
      });
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(new Error(`Could not start "${bin}": ${error.message}`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error(`"${bin}" exited with ${code}: ${stderr.slice(-2000)}`));
        else resolve({ text: stdout, model: this.model });
      });

      if (this.opts.promptVia === 'stdin') child.stdin.write(prompt);
      child.stdin.end();
    });
  }
}
