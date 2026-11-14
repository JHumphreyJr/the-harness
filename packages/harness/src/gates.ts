import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { GateRequest } from './graph.js';
import { runsDir } from './run.js';
import type { GateDecision } from './types.js';

/**
 * File-based gates: the harness writes each approval request as JSON and waits for a matching
 * response file. This lets whoever holds the decision answer from anywhere that can write to the
 * project folder (another terminal, a script, a remote operator) instead of the run's own stdin.
 *
 *   .foundry/runs/<runId>/gates/01-request.json    written by the harness
 *   .foundry/runs/<runId>/gates/01-response.json   written by the approver
 *
 * Agents cannot answer their own gates: the tool policy blocks every write under .foundry/runs.
 */

const ResponseSchema = z.object({
  decision: z.enum(['approve', 'revise']),
  feedback: z.string().optional(),
  answers: z.record(z.string(), z.string()).optional(),
  /** Who decided. Recorded verbatim in the audit log and the run report. */
  by: z.string().min(1),
});

export const gatesDir = (projectDir: string, runId: string) => join(runsDir(projectDir), runId, 'gates');

export async function fileGate(
  request: GateRequest,
  run: { runId: string; projectDir: string },
  opts: { pollMs?: number; log?: (line: string) => void } = {},
): Promise<GateDecision> {
  const dir = gatesDir(run.projectDir, run.runId);
  mkdirSync(dir, { recursive: true });
  const number = String(readdirSync(dir).filter((name) => name.endsWith('-request.json')).length + 1).padStart(2, '0');
  const responseFile = join(dir, `${number}-response.json`);
  writeFileSync(
    join(dir, `${number}-request.json`),
    `${JSON.stringify({ ...request, respondWith: { file: `${number}-response.json`, shape: { decision: 'approve | revise', feedback: 'required when revising', answers: 'clarify: {"0": "...", "1": "..."}; scope: {"tier": "..."}', by: 'who decided' } } }, null, 2)}\n`,
  );
  opts.log?.(`Waiting for ${responseFile}`);

  for (;;) {
    if (existsSync(responseFile)) {
      try {
        return ResponseSchema.parse(JSON.parse(readFileSync(responseFile, 'utf8')));
      } catch (error) {
        // A half-written or malformed file: say so once per poll and keep waiting for a fix.
        opts.log?.(`Cannot read ${number}-response.json yet: ${(error as Error).message.split('\n')[0]}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, opts.pollMs ?? 1000));
  }
}
