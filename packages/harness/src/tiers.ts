import type { Gate, ReviewLens, Tier } from './types.js';

/**
 * A tier profile is data, not prompt text. The graph reads it to decide which nodes run,
 * which human gates open, and which standards documents each role receives.
 * Changing how much process a tier gets means editing this file and nothing else.
 */
export interface TierProfile {
  tier: Tier;
  label: string;
  intent: string;
  /** Upper bound on clarifying questions the analyst may ask before the PRD is written. */
  maxClarifyingQuestions: number;
  /** Human approval gates. A gate not listed here is auto-approved and logged as such. */
  gates: Gate[];
  stages: {
    threatModel: boolean;
    /** UX spec is produced for every graphical product regardless of tier. */
    uxSpec: 'when-graphical';
  };
  /** Review lenses that run in parallel on the pull request. `ux` only applies to graphical products. */
  reviewLenses: ReviewLens[];
  maxReviewRounds: number;
  maxQaRounds: number;
  /** When true, every functional requirement must have a passing QA case; an untested one fails QA. */
  qaRequiresFullCoverage: boolean;
  maxVerifyAttempts: number;
  /** Standards documents (assets/standards/*.md) injected into role prompts. */
  standards: {
    architecture: string;
    security: string;
    testing: string;
    always: string[];
  };
  requiredDocs: string[];
}

export const TIER_PROFILES: Record<Tier, TierProfile> = {
  prototype: {
    tier: 'prototype',
    label: 'Prototype / internal tool',
    intent:
      'Prove an idea or ship a small tool quickly. One deployable unit. No authentication, tenancy or isolation work. UX and clean-code standards still apply in full.',
    maxClarifyingQuestions: 3,
    gates: ['scope', 'requirements', 'usability'],
    stages: { threatModel: false, uxSpec: 'when-graphical' },
    reviewLenses: ['code', 'ux'],
    maxReviewRounds: 2,
    maxQaRounds: 2,
    qaRequiresFullCoverage: false,
    maxVerifyAttempts: 3,
    standards: {
      architecture: 'architecture-prototype',
      testing: 'testing-prototype',
      security: 'security-baseline',
      always: ['clean-code', 'ux', 'documentation'],
    },
    requiredDocs: ['README.md'],
  },
  'production-small': {
    tier: 'production-small',
    label: 'Production, small scale',
    intent:
      'Real users and real data, but low volume. Every security standard applies. Scale-out infrastructure (load balancers, sharding, queues, CQRS) is out of scope unless an ADR justifies it.',
    maxClarifyingQuestions: 7,
    gates: ['scope', 'requirements', 'ux', 'architecture', 'threat-model', 'usability', 'release'],
    stages: { threatModel: true, uxSpec: 'when-graphical' },
    reviewLenses: ['code', 'security', 'ux'],
    maxReviewRounds: 3,
    maxQaRounds: 3,
    qaRequiresFullCoverage: true,
    maxVerifyAttempts: 4,
    standards: {
      architecture: 'architecture-production-small',
      testing: 'testing-production-small',
      security: 'security-production',
      always: ['clean-code', 'ux', 'documentation'],
    },
    requiredDocs: ['README.md', 'docs/operations/RUNBOOK.md'],
  },
  'production-scale': {
    tier: 'production-scale',
    label: 'Production, at scale',
    intent:
      'High traffic or high consequence. Layered architecture, horizontal scale, resilience patterns, zero trust, and full observability are required and reviewed.',
    maxClarifyingQuestions: 12,
    gates: ['scope', 'requirements', 'ux', 'architecture', 'threat-model', 'usability', 'release'],
    stages: { threatModel: true, uxSpec: 'when-graphical' },
    reviewLenses: ['code', 'security', 'ux', 'architecture'],
    maxReviewRounds: 4,
    maxQaRounds: 4,
    qaRequiresFullCoverage: true,
    maxVerifyAttempts: 4,
    standards: {
      architecture: 'architecture-production-scale',
      testing: 'testing-production-scale',
      security: 'security-production',
      always: ['clean-code', 'ux', 'documentation'],
    },
    requiredDocs: ['README.md', 'docs/operations/RUNBOOK.md', 'docs/operations/SLOS.md'],
  },
};

export function profileFor(tier: Tier): TierProfile {
  return TIER_PROFILES[tier];
}

export function lensesFor(tier: Tier, graphical: boolean): ReviewLens[] {
  return TIER_PROFILES[tier].reviewLenses.filter((lens) => lens !== 'ux' || graphical);
}

export function gateIsHuman(tier: Tier, gate: Gate): boolean {
  return TIER_PROFILES[tier].gates.includes(gate);
}
