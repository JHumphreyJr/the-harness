import type { AgentResult, AgentRunner, AgentTask } from './types.js';

/**
 * Plain chat-model runner through LangChain's universal initialiser, so any provider LangChain
 * supports works by changing one string. It has no tools: the harness inlines all context and
 * writes the output to disk itself. Suited to analyst, product, UX, architect, security,
 * planner, writer and reviewer roles.
 *
 * Install the provider package you use, for example `npm i @langchain/openai`.
 */
export class ChatModelRunner implements AgentRunner {
  readonly kind = 'chat';
  readonly workspace = false;
  readonly model: string;

  constructor(
    readonly name: string,
    private readonly opts: { model: string; temperature?: number },
  ) {
    this.model = opts.model;
  }

  async run(task: AgentTask): Promise<AgentResult> {
    const { initChatModel } = await import('langchain');
    let model;
    try {
      model = await initChatModel(this.opts.model, {
        ...(this.opts.temperature !== undefined ? { temperature: this.opts.temperature } : {}),
      });
    } catch (error) {
      throw new Error(
        `Could not initialise chat model "${this.opts.model}". Install its LangChain provider package ` +
          `(for example @langchain/openai or @langchain/anthropic) and set its API key. Cause: ${(error as Error).message}`,
      );
    }
    const reply = await model.invoke([
      { role: 'system', content: task.instructions },
      { role: 'user', content: task.input },
    ]);
    const text =
      typeof reply.content === 'string'
        ? reply.content
        : reply.content.map((part) => ('text' in part && typeof part.text === 'string' ? part.text : '')).join('');
    const meta = reply.usage_metadata;
    return {
      text,
      model: this.model,
      ...(meta ? { usage: { inputTokens: meta.input_tokens, outputTokens: meta.output_tokens } } : {}),
    };
  }
}
