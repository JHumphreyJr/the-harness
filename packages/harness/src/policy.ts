import { isAbsolute, relative, resolve } from 'node:path';

/**
 * Guardrails applied to agent tool calls where the runner exposes them (the Claude Agent SDK
 * runner, via PreToolUse hooks). CLI runners bring their own sandbox; run those in one.
 *
 * The rules encode two invariants of the harness:
 *   1. Agents never publish. Pushing, merging and releasing are harness or human actions.
 *   2. Agents stay inside the project directory.
 */

export interface PolicyVerdict {
  allow: boolean;
  reason?: string;
}

const DENIED_COMMANDS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bgit\s+push\b/, reason: 'Agents do not push. The harness publishes the branch after verification.' },
  { pattern: /\bgit\s+(merge|rebase)\b.*\b(main|master)\b/, reason: 'Agents do not merge into the default branch.' },
  { pattern: /\bgit\s+reset\s+--hard\b/, reason: 'Destructive history rewrite is not allowed.' },
  { pattern: /\bgh\s+pr\s+(merge|close)\b/, reason: 'Merging or closing pull requests is a human decision.' },
  { pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+(\/|~|\$HOME)(\s|$)/, reason: 'Refusing recursive delete outside the project.' },
  { pattern: /\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z)?sh\b/, reason: 'Piping a download into a shell is not allowed.' },
  { pattern: /\bsudo\b/, reason: 'Privilege escalation is not allowed.' },
  { pattern: /\b(cargo\s+publish|npm\s+publish)\b/, reason: 'Publishing packages is a human decision.' },
  { pattern: /\.foundry\/runs\b/, reason: 'The audit trail is written by the harness only.' },
];

export function checkCommand(command: string): PolicyVerdict {
  for (const rule of DENIED_COMMANDS) {
    if (rule.pattern.test(command)) return { allow: false, reason: rule.reason };
  }
  return { allow: true };
}

export function checkPath(projectDir: string, target: string): PolicyVerdict {
  const absolute = isAbsolute(target) ? target : resolve(projectDir, target);
  const rel = relative(projectDir, absolute);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return { allow: false, reason: `Write outside the project directory: ${target}` };
  }
  if (rel.startsWith('.foundry/runs') || rel.startsWith('.git/')) {
    return { allow: false, reason: `Protected path: ${rel}` };
  }
  return { allow: true };
}

/** Single entry point used by runner hooks. */
export function checkToolCall(projectDir: string, tool: string, input: unknown): PolicyVerdict {
  const args = (input ?? {}) as Record<string, unknown>;
  if (tool === 'Bash' && typeof args.command === 'string') return checkCommand(args.command);
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const path = args.file_path ?? args.notebook_path;
    if (typeof path === 'string') return checkPath(projectDir, path);
  }
  return { allow: true };
}
