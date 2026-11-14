import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AgentResult, AgentRunner, AgentTask, RunnerContext } from './types.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const json = (value: unknown) => `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;

/**
 * Deterministic stand-in for a model. It produces well-formed output for every node so the
 * whole graph, the audit trail and the viewer can be exercised offline with no API key.
 * The first code review requests changes on purpose, to exercise the fix loop.
 */
export class MockRunner implements AgentRunner {
  readonly kind = 'mock';
  readonly model = 'mock-1';
  readonly workspace = true;

  constructor(
    readonly name: string,
    private readonly opts: { stepMs: number },
  ) {}

  private async act(ctx: RunnerContext, steps: [tool: string, detail: string][]): Promise<void> {
    for (const [tool, detail] of steps) {
      await sleep(this.opts.stepMs);
      ctx.emit({ type: 'agent.tool', data: { tool, detail } });
    }
    await sleep(this.opts.stepMs);
  }

  async run(task: AgentTask, ctx: RunnerContext): Promise<AgentResult> {
    const text = await this.reply(task, ctx);
    return { text, model: this.model, usage: { inputTokens: task.input.length >> 2, outputTokens: text.length >> 2 } };
  }

  private async reply(task: AgentTask, ctx: RunnerContext): Promise<string> {
    const meta = task.meta ?? {};
    switch (task.node) {
      case 'scope':
        await this.act(ctx, [['Think', 'Who uses this, how many, what data is at risk']]);
        return json({
          tier: 'production-small',
          graphical: true,
          platforms: ['web'],
          stack: ['TypeScript', 'Web Components', 'Node.js', 'SQLite'],
          rationale:
            'Real users and stored personal data, so production standards apply. Expected usage is a few dozen people, so scale-out infrastructure is not justified.',
        });

      case 'elicit':
        await this.act(ctx, [['Think', 'What is still ambiguous in the request']]);
        return json({
          questions: [
            {
              question: 'Who signs in, and with what identity provider?',
              why: 'Determines the authentication design.',
              assumption: 'Members sign in with an existing OIDC provider; no local passwords.',
            },
            {
              question: 'What must never be lost?',
              why: 'Sets backup and recovery targets.',
              assumption: 'Entries are backed up nightly; a day of data loss is tolerable.',
            },
            {
              question: 'Which devices matter most?',
              why: 'Drives layout and offline decisions.',
              assumption: 'Phones first, used outdoors with weak signal.',
            },
          ],
        });

      case 'requirements':
        await this.act(ctx, [
          ['Read', 'clarifications'],
          ['Write', 'docs/product/PRD.md'],
        ]);
        return [
          '# Product Requirements',
          '',
          '## Problem',
          'Members record outings on paper and the notes are lost.',
          '',
          '## Users and jobs',
          '- **Member**: log an outing in under a minute, from a phone, outdoors.',
          '- **Organiser**: see what the group did this month.',
          '',
          '## Functional requirements',
          '- **FR-1** A member can create, edit and delete their own entries.',
          '- **FR-2** An organiser can view all entries, filtered by month.',
          '- **FR-3** Entries created offline sync when the connection returns.',
          '',
          '## Non-functional requirements',
          '- **NFR-1** Sign-in through the existing OIDC provider.',
          '- **NFR-2** WCAG 2.2 AA.',
          '- **NFR-3** First interaction within 2 seconds on a mid-range phone.',
          '',
          '## Non-goals',
          '- Public sharing, social features, native apps.',
          '',
          json({ summary: 'Three functional and three non-functional requirements for an outing log.' }),
        ].join('\n');

      case 'ux':
        await this.act(ctx, [
          ['Read', 'docs/product/PRD.md'],
          ['Write', 'docs/ux/UX-SPEC.md'],
        ]);
        return [
          '# UX Specification',
          '',
          '## Principles',
          'One thumb, bright sunlight, under a minute.',
          '',
          '## Key flow: log an outing',
          '1. Open app, land on the list with a prominent "New entry" action.',
          '2. Form with three fields; date defaults to today.',
          '3. Save returns to the list with the new entry highlighted.',
          '',
          '## States',
          'Empty, loading, offline (entries queued), error with a retry action.',
          '',
          '## Accessibility',
          'Contrast at least 4.5:1, 44 px targets, full keyboard path, reduced-motion respected.',
          '',
          json({
            summary: 'Phone-first flow with explicit empty, offline and error states.',
            guidelines: [{ name: 'WCAG 2.2', url: 'https://www.w3.org/TR/WCAG22/', applied: 'Contrast (1.4.3), target size (2.5.8) and focus visibility (2.4.11) on every screen.' }],
          }),
        ].join('\n');

      case 'architecture':
        await this.act(ctx, [
          ['Read', 'docs/product/PRD.md'],
          ['Read', 'docs/ux/UX-SPEC.md'],
          ['Write', 'docs/architecture/ARCHITECTURE.md'],
        ]);
        return [
          '# Architecture',
          '',
          '## Shape',
          'A modular monolith: one Node.js service serving the API and the built web client, one SQLite database.',
          '',
          '## Modules',
          '`entries`, `identity`, `sync`. Modules depend on interfaces, not on each other\'s storage.',
          '',
          '## Deliberately omitted',
          'Load balancer, queue, cache, read replicas. The service stays stateless so they can be added later.',
          '',
          json({
            summary: 'Modular monolith on a single node with SQLite.',
            performanceBudget: [
              { metric: 'Initial JavaScript, compressed', target: 'under 30 kB' },
              { metric: 'First interaction on a mid-range phone', target: 'under 2 s' },
            ],
            dependencies: [],
            guidelines: [{ name: 'TypeScript handbook: strictness', applied: 'Strict mode and schema-validated boundaries across all modules.' }],
            decisions: [
              {
                title: 'Use a modular monolith on a single node',
                context: 'A few dozen users. The team is one person.',
                options: [
                  { name: 'Modular monolith', pros: 'One deploy, simple operations.', cons: 'Vertical scaling only.' },
                  { name: 'Microservices', pros: 'Independent scaling.', cons: 'Operational cost with no matching need.' },
                ],
                decision: 'Modular monolith.',
                consequences: 'Keep the service stateless so horizontal scaling stays cheap to add.',
              },
              {
                title: 'Use SQLite with nightly off-host backups',
                context: 'Low write volume. A day of data loss is acceptable.',
                options: [
                  { name: 'SQLite', pros: 'No server to run.', cons: 'Single writer.' },
                  { name: 'PostgreSQL', pros: 'Concurrency, replicas.', cons: 'More to operate.' },
                ],
                decision: 'SQLite, encrypted at rest, backed up nightly.',
                consequences: 'Access goes through a repository interface so the store can be swapped.',
              },
            ],
          }),
        ].join('\n');

      case 'threat_model':
        await this.act(ctx, [
          ['Read', 'docs/architecture/ARCHITECTURE.md'],
          ['Write', 'docs/security/THREAT-MODEL.md'],
        ]);
        return [
          '# Threat Model',
          '',
          '| Threat (STRIDE) | Asset | Control |',
          '|---|---|---|',
          '| Spoofing | Member identity | OIDC with PKCE, short-lived sessions |',
          '| Tampering | Entries | Object-level authorisation on every write |',
          '| Information disclosure | Entries | TLS 1.3, encryption at rest, no entry ids in URLs without access checks |',
          '| Denial of service | API | Per-user rate limit at the application |',
          '',
          json({ summary: 'Four threats with a control each; object-level authorisation is the main risk.', decisions: [] }),
        ].join('\n');

      case 'plan':
        await this.act(ctx, [['Read', 'docs/architecture/ARCHITECTURE.md']]);
        return json({
          tasks: [
            {
              id: 'T1',
              title: 'Entries module with repository interface',
              description: 'Create, edit, delete and list entries behind a repository interface.',
              track: 'server',
              dependsOn: [],
              size: 'medium',
              risk: 'high',
              requirements: ['FR-1', 'FR-2'],
              acceptance: ['A member cannot modify another member\'s entry.', 'Unit tests cover the repository.'],
            },
            {
              id: 'T2',
              title: 'Entry list and form',
              description: 'Phone-first list and form with empty, loading, offline and error states.',
              track: 'web',
              platform: 'web',
              dependsOn: [],
              size: 'small',
              risk: 'low',
              requirements: ['FR-1', 'FR-3', 'NFR-2'],
              acceptance: ['Keyboard-only path works.', 'Offline entries are queued and synced.'],
            },
          ],
        });

      case 'implement': {
        const id = String(meta.taskId ?? 'T0');
        const file = `src/${id.toLowerCase()}.ts`;
        await this.act(ctx, [
          ['Read', 'docs/plan/TASKS.md'],
          ['Write', file],
          ['Write', `src/${id.toLowerCase()}.test.ts`],
          ['Bash', 'npm test'],
        ]);
        this.write(task.cwd, file, `export const task = ${JSON.stringify(id)};\n`);
        this.write(task.cwd, `src/${id.toLowerCase()}.test.ts`, `// tests for ${id}\n`);
        return `Implemented ${id} with tests.`;
      }

      case 'fix':
        await this.act(ctx, [
          ['Read', 'docs/reviews'],
          ['Edit', 'src/t1.ts'],
          ['Bash', 'npm test'],
        ]);
        this.write(task.cwd, 'src/t1.ts', 'export const task = "T1";\nexport const ownerCheck = true;\n');
        return 'Addressed the review findings.';

      case 'qa':
        await this.act(ctx, [
          ['Read', 'docs/product/PRD.md'],
          ['Bash', 'npm test'],
          ['Think', 'Tracing each requirement to evidence'],
        ]);
        return json({
          summary: 'Critical flows exercised through the automated tests; nothing blocking.',
          cases: [
            { requirement: 'FR-1', check: 'Create, edit and delete an entry as its owner', result: 'pass', evidence: 'npm test: entries suite, 6 passing' },
            { requirement: 'FR-2', check: 'Organiser lists entries by month', result: 'pass', evidence: 'npm test: listing suite, 3 passing' },
            { requirement: 'FR-3', check: 'Offline entries sync on reconnect', result: 'pass', evidence: 'npm test: sync suite with a simulated dropped connection, 4 passing' },
          ],
          defects: [],
        });

      case 'usability_prep':
        await this.act(ctx, [['Write', 'docs/ux/USABILITY-TEST.md']]);
        return ['# Usability test plan', '', '## Participants', 'Three club members who have not seen the app.', '', '## Tasks', '1. Log the outing you went on last weekend.', '2. Find out how many outings the club had this month.', '', '## Success', 'Each task finished without help in under a minute.', '', json({ summary: 'Two tasks, three participants.' })].join('\n');

      case 'document':
        await this.act(ctx, [['Write', 'README.md']]);
        return [
          '=== FILE: README.md ===',
          '# Outing Log',
          '',
          'Run `npm install` then `npm start`. See `docs/` for requirements, architecture and decisions.',
          '=== END FILE ===',
          '=== FILE: docs/operations/RUNBOOK.md ===',
          '# Runbook',
          '',
          'Health check at `/healthz`. Restore from the nightly backup with `scripts/restore.sh`.',
          '=== END FILE ===',
        ].join('\n');

      default:
        if (task.node.startsWith('review_')) {
          const lens = String(meta.lens ?? 'code');
          const round = Number(meta.round ?? 1);
          await this.act(ctx, [
            ['Read', 'pull request diff'],
            ['Think', `Checking against the ${lens} standard`],
          ]);
          if (lens === 'code' && round === 1) {
            return json({
              verdict: 'request-changes',
              summary: 'One authorisation gap; otherwise clean.',
              findings: [
                {
                  severity: 'major',
                  file: 'src/t1.ts',
                  line: 1,
                  summary: 'Delete does not verify that the caller owns the entry.',
                  recommendation: 'Check ownership in the repository method and add a test for the negative case.',
                },
              ],
            });
          }
          return json({ verdict: 'approve', summary: `No ${lens} issues found.`, findings: [] });
        }
        return 'Done.';
    }
  }

  private write(cwd: string, file: string, content: string): void {
    const target = join(cwd, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}
