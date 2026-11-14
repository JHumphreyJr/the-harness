import { z } from 'zod';
import { PLATFORMS, REGIMES, TIERS } from './types.js';

/** Structured outputs agents must return. Validated on receipt; a failed parse is retried once. */

export const ScopeSchema = z.object({
  tier: z.enum(TIERS),
  graphical: z.boolean(),
  platforms: z.array(z.enum(PLATFORMS)).min(1),
  stack: z.array(z.string()).min(1),
  rationale: z.string(),
});

export const ElicitSchema = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      why: z.string(),
      /** What the team will assume if nobody answers. Recorded verbatim in the PRD. */
      assumption: z.string(),
    }),
  ),
});

export const SummarySchema = z.object({ summary: z.string() });

/** An official platform or language guideline the work was designed against. */
const GuidelineSchema = z.object({
  name: z.string(),
  url: z.string().optional(),
  /** The specific sections or rules relied on, and where they shaped the design. */
  applied: z.string(),
});
export type Guideline = z.infer<typeof GuidelineSchema>;

export const UxSchema = z.object({
  summary: z.string(),
  guidelines: z.array(GuidelineSchema).min(1, 'name the platform guidelines this design follows'),
});

const DecisionSchema = z.object({
  title: z.string(),
  context: z.string(),
  options: z.array(z.object({ name: z.string(), pros: z.string(), cons: z.string() })).default([]),
  decision: z.string(),
  consequences: z.string(),
});

/** `guidelines` is required for architecture and optional for the threat model; the graph enforces which. */
export const DesignSchema = z.object({
  summary: z.string(),
  decisions: z.array(DecisionSchema).default([]),
  guidelines: z.array(GuidelineSchema).default([]),
  /** Every third-party dependency the design introduces. Empty is the preferred answer. */
  dependencies: z
    .array(
      z.object({
        name: z.string(),
        purpose: z.string(),
        /** What the platform or standard library could not do. */
        whyNotPlatform: z.string(),
        /** Measured or documented runtime cost: size, startup, memory, extra runtime. */
        cost: z.string(),
        /** Evidence of maturity and security testing: age, maintenance, audits, advisory history. */
        maturity: z.string(),
      }),
    )
    .default([]),
  /** Domain experts the architect wants to challenge specific decisions before the design is final. */
  consults: z.array(z.object({ expert: z.string(), topic: z.string(), questions: z.array(z.string()).default([]) })).default([]),
  /** Measurable targets the implementation is held to. Required for architecture. */
  performanceBudget: z.array(z.object({ metric: z.string(), target: z.string() })).default([]),
});

export const PlanSchema = z.object({
  tasks: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        description: z.string(),
        requirements: z.array(z.string()).default([]),
        acceptance: z.array(z.string()).default([]),
        track: z.string().default('main'),
        platform: z.enum(PLATFORMS).optional(),
        dependsOn: z.array(z.string()).default([]),
        size: z.enum(['small', 'medium', 'large']).default('medium'),
        risk: z.enum(['low', 'medium', 'high']).default('medium'),
      }),
    )
    .min(1),
});

export const ReviewSchema = z.object({
  verdict: z.enum(['approve', 'request-changes']),
  summary: z.string(),
  findings: z
    .array(
      z.object({
        severity: z.enum(['blocker', 'major', 'minor', 'nit']),
        file: z.string().optional(),
        line: z.number().int().optional(),
        summary: z.string(),
        recommendation: z.string(),
      }),
    )
    .default([]),
});

const FindingSchema = z.object({
  severity: z.enum(['blocker', 'major', 'minor', 'nit']),
  file: z.string().optional(),
  line: z.number().int().optional(),
  summary: z.string(),
  recommendation: z.string(),
});

export const ExpertSchema = z.object({
  verdict: z.enum(['endorse', 'concerns', 'reject']),
  summary: z.string(),
  findings: z.array(z.object({ severity: z.enum(['blocker', 'major', 'minor']), summary: z.string(), recommendation: z.string() })).default([]),
  /** Official documentation consulted, so the advice can be checked. */
  sources: z.array(z.string()).default([]),
});

export const ComplianceSchema = z.object({
  summary: z.string(),
  dataCategories: z.array(z.object({ category: z.string(), examples: z.string(), stored: z.boolean(), notes: z.string().default('') })).default([]),
  regimes: z.array(
    z.object({
      id: z.enum(REGIMES),
      name: z.string(),
      applies: z.enum(['yes', 'no', 'uncertain']),
      reason: z.string(),
      obligations: z.array(z.string()).default([]),
      rightTools: z.array(z.string()).default([]),
      /** What change to the product would make this regime apply, or stop applying. */
      reassessIf: z.string().default(''),
    }),
  ),
  /** Facts the approver must supply before an uncertain regime can be decided. */
  questions: z.array(z.string()).default([]),
});

export const QaSchema = z.object({
  summary: z.string(),
  cases: z.array(
    z.object({
      /** A requirement id from the PRD (FR-3, NFR-1). */
      requirement: z.string(),
      check: z.string(),
      result: z.enum(['pass', 'fail', 'not-run']),
      /** The command run and what it showed, or why the check could not be run. */
      evidence: z.string(),
    }),
  ),
  defects: z.array(FindingSchema).default([]),
});

/** Splits a reply into its prose body and its final ```json block. */
export function splitReply(text: string): { body: string; json: string | null } {
  const blocks = [...text.matchAll(/```json\s*\n([\s\S]*?)\n```/g)];
  const last = blocks.at(-1);
  if (!last || last.index === undefined) return { body: text.trim(), json: null };
  return { body: text.slice(0, last.index).trim(), json: last[1] ?? null };
}

export function formatInstruction(schema: z.ZodType): string {
  return [
    'Finish your reply with exactly one fenced ```json block that conforms to this JSON Schema.',
    'Put nothing after it.',
    '```',
    JSON.stringify(z.toJSONSchema(schema), null, 2),
    '```',
  ].join('\n');
}

/** Parses `=== FILE: path ===` ... `=== END FILE ===` blocks. */
export function parseFileBlocks(text: string): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  const pattern = /^=== FILE: (.+?) ===\n([\s\S]*?)\n=== END FILE ===$/gm;
  for (const match of text.matchAll(pattern)) {
    files.push({ path: (match[1] ?? '').trim(), content: `${match[2] ?? ''}\n` });
  }
  return files;
}
