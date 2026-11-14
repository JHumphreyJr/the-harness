/** Shared domain types. Kept free of runtime dependencies so every module can import it. */

export const TIERS = ['prototype', 'production-small', 'production-scale'] as const;
export type Tier = (typeof TIERS)[number];

export const PLATFORMS = ['web', 'ios', 'android', 'native', 'embedded'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const ROLES = [
  'analyst',
  'product',
  'ux',
  'architect',
  'security',
  'planner',
  'developer',
  'qa',
  'reviewer',
  'writer',
] as const;
export type Role = (typeof ROLES)[number];

export const REVIEW_LENSES = ['code', 'security', 'ux', 'architecture'] as const;
export type ReviewLens = (typeof REVIEW_LENSES)[number];

export const GATES = ['scope', 'requirements', 'ux', 'architecture', 'threat-model', 'usability', 'release'] as const;
export type Gate = (typeof GATES)[number];

export interface Surfaces {
  /** True when a human looks at and interacts with the product (GUI, TUI, display). */
  graphical: boolean;
  platforms: Platform[];
}

export interface Clarification {
  question: string;
  answer: string;
  /** "human" when answered at a gate, "assumed" when the analyst had to assume (unattended runs). */
  source: 'human' | 'assumed';
}

export interface PlanTask {
  id: string;
  title: string;
  description: string;
  /** Requirement ids from the PRD (FR-1, NFR-2) that this task satisfies. */
  requirements: string[];
  acceptance: string[];
  /** The part of the system this task belongs to (contract, database, server, web, ios, ...). One agent per track at a time. */
  track: string;
  /** Set when the track is a single target platform, so the agent gets only that platform's standards. */
  platform?: Platform;
  /** Ids of tasks that must be finished first. */
  dependsOn: string[];
  size: 'small' | 'medium' | 'large';
  risk: 'low' | 'medium' | 'high';
}

export interface QaCase {
  requirement: string;
  check: string;
  result: 'pass' | 'fail' | 'not-run';
  evidence: string;
}

export interface QaResult {
  round: number;
  verdict: 'pass' | 'fail';
  summary: string;
  cases: QaCase[];
  defects: Finding[];
  tester: { runner: string; model: string };
}

export interface Finding {
  severity: 'blocker' | 'major' | 'minor' | 'nit';
  file?: string;
  line?: number;
  summary: string;
  recommendation: string;
}

export interface ReviewResult {
  lens: ReviewLens;
  round: number;
  verdict: 'approve' | 'request-changes';
  summary: string;
  findings: Finding[];
  reviewer: { runner: string; model: string };
}

export interface VerifyResult {
  ok: boolean;
  steps: { command: string; exitCode: number; output: string; durationMs: number }[];
}

export interface GateDecision {
  decision: 'approve' | 'revise';
  feedback?: string;
  /** Free-form answers, used by the scope gate (tier override) and the clarification step. */
  answers?: Record<string, string>;
  by: string;
}

export interface DecisionRecord {
  title: string;
  context: string;
  options: { name: string; pros: string; cons: string }[];
  decision: string;
  consequences: string;
}
