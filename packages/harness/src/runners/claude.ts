import { checkToolCall } from '../policy.js';
import type { AgentResult, AgentRunner, AgentTask, RunnerContext } from './types.js';

function summarise(input: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>;
  const pick = args.file_path ?? args.command ?? args.pattern ?? args.path ?? args.url ?? args.description;
  const text = typeof pick === 'string' ? pick : JSON.stringify(args);
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

/**
 * Runs a role as a Claude Agent SDK session. Each call is a fresh session with its own context,
 * which is what makes the reviewer independent of the developer.
 */
export class ClaudeAgentRunner implements AgentRunner {
  readonly kind = 'claude-agent-sdk';
  readonly workspace = true;
  readonly model: string;

  constructor(
    readonly name: string,
    private readonly opts: { model?: string; maxTurns: number },
  ) {
    this.model = opts.model ?? 'claude-default';
  }

  async run(task: AgentTask, ctx: RunnerContext): Promise<AgentResult> {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    // Web access is read-only and exists so agents can consult official platform guidelines.
    const readTools = ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'];
    const allowedTools =
      task.access === 'write' ? [...readTools, 'Write', 'Edit', 'Bash'] : task.access === 'read' ? readTools : [];

    const session = query({
      prompt: task.input,
      options: {
        cwd: task.cwd,
        systemPrompt: task.instructions,
        ...(this.opts.model ? { model: this.opts.model } : {}),
        maxTurns: this.opts.maxTurns,
        allowedTools,
        // Anything not explicitly allowed is refused instead of prompting: runs are unattended.
        permissionMode: 'dontAsk',
        // Do not inherit the operator's personal Claude Code settings; runs must be reproducible.
        settingSources: [],
        hooks: {
          PreToolUse: [
            {
              onFailure: 'block',
              hooks: [
                async (input) => {
                  if (input.hook_event_name !== 'PreToolUse') return {};
                  const verdict = checkToolCall(task.cwd, input.tool_name, input.tool_input);
                  if (!verdict.allow) {
                    ctx.emit({
                      type: 'policy.denied',
                      data: { tool: input.tool_name, detail: summarise(input.tool_input), reason: verdict.reason },
                    });
                    return {
                      hookSpecificOutput: {
                        hookEventName: 'PreToolUse',
                        permissionDecision: 'deny',
                        permissionDecisionReason: verdict.reason ?? 'Denied by harness policy',
                      },
                    };
                  }
                  ctx.emit({ type: 'agent.tool', data: { tool: input.tool_name, detail: summarise(input.tool_input) } });
                  return {};
                },
              ],
            },
          ],
        },
      },
    });

    let text = '';
    let usage: AgentResult['usage'];
    for await (const message of session) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text' && block.text.trim()) {
            ctx.emit({ type: 'agent.message', data: { text: block.text.slice(0, 400) } });
          }
        }
      } else if (message.type === 'result') {
        if (message.subtype !== 'success') {
          throw new Error(`Claude session for ${task.agent} ended with ${message.subtype}`);
        }
        text = message.result;
        usage = {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          costUsd: message.total_cost_usd,
        };
      }
    }
    return { text, model: this.model, usage };
  }
}
