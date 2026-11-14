import { Annotation, END, START, StateGraph, interrupt, type BaseCheckpointSaver } from '@langchain/langgraph';
import { join as joinPath } from 'node:path';
import { reviewIndependence, reviewRunners } from './config.js';
import { assign, nextWave } from './dispatch.js';
import { analyseSbom, generateSbom, renderNotices, renderSbomReport, SBOM_FILE, type SbomReport } from './sbom.js';
import { expertCatalogue } from './prompts.js';
import { Git } from './git.js';
import type { Harness } from './harness.js';
import { ComplianceSchema, DesignSchema, ElicitSchema, ExpertSchema, PlanSchema, QaSchema, ReviewSchema, ScopeSchema, SummarySchema, UxSchema, parseFileBlocks, type Guideline } from './schemas.js';
import { gateIsHuman, lensesFor, profileFor } from './tiers.js';
import { TOPOLOGY } from './topology.js';
import {
  REVIEW_LENSES,
  type Clarification,
  type Consult,
  type Gate,
  type GateDecision,
  type PlanTask,
  type QaResult,
  type ReviewLens,
  type ReviewResult,
  type Role,
  type Surfaces,
  type Tier,
  type VerifyResult,
} from './types.js';
import { detectVerifyCommands, runVerify } from './verify.js';

const merge = <T>(left: Record<string, T>, right: Record<string, T>) => ({ ...left, ...right });

/** A last-write-wins channel with a default, so a checkpoint from an older build that lacks it still loads. */
const withDefault = <T>(initial: () => T) => Annotation<T>({ reducer: (_previous, next) => next, default: initial });

/** Graph state. Everything here is checkpointed after each node, so a run can resume after a crash. */
export const RunState = Annotation.Root({
  request: Annotation<string>(),
  tier: Annotation<Tier>(),
  /** True when the operator fixed the tier up front; the analyst then only classifies the surface. */
  tierPinned: Annotation<boolean>(),
  surfaces: Annotation<Surfaces>(),
  stack: Annotation<string[]>(),
  scopeRationale: Annotation<string>(),
  questions: Annotation<{ question: string; why: string; assumption: string }[]>(),
  clarifications: Annotation<Clarification[]>(),
  artifacts: Annotation<Record<string, string>>({ reducer: merge, default: () => ({}) }),
  decisions: Annotation<string[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  tasks: Annotation<PlanTask[]>(),
  /** Unused. Kept so checkpoints written before parallel build tracks existed still load. */
  taskIndex: withDefault<number>(() => 0),
  /** Ids of tasks whose work is merged and verified. */
  done: withDefault<string[]>(() => []),
  /** Ids of the tasks merged in the current wave, awaiting verification. */
  wave: withDefault<string[]>(() => []),
  /** Ids of tasks that must run alone because a parallel attempt could not be merged. */
  serial: withDefault<string[]>(() => []),
  phase: Annotation<'build' | 'fix'>(),
  /** Where rework returns to once it verifies: QA before the pull request exists, review after. */
  stage: withDefault<'qa' | 'review'>(() => 'qa'),
  qaResult: withDefault<QaResult | null>(() => null),
  qaRound: withDefault<number>(() => 0),
  /** Ids of the regulatory regimes found applicable. Their control packs are added to agent prompts. */
  regimes: withDefault<string[]>(() => []),
  /** Experts the architect asked to consult on the draft design. */
  consults: withDefault<Consult[]>(() => []),
  consultRound: withDefault<number>(() => 0),
  sbomRound: withDefault<number>(() => 0),
  /** Shipped components whose licence the policy forbids, awaiting rework. */
  licenseViolations: withDefault<string[]>(() => []),
  checks: Annotation<VerifyResult | null>(),
  verifyAttempts: Annotation<number>(),
  reviewRound: Annotation<number>(),
  /** Keyed by `${round}:${lens}` so parallel reviewers can write without clobbering each other. */
  reviews: Annotation<Record<string, ReviewResult>>({ reducer: merge, default: () => ({}) }),
  /** Latest revision feedback per gate, consumed by the node that redoes the work. */
  feedback: Annotation<Record<string, string>>({ reducer: merge, default: () => ({}) }),
  gates: Annotation<Record<string, GateDecision>>({ reducer: merge, default: () => ({}) }),
  /** Problems the automated loops could not resolve. Forces a human release gate at every tier. */
  unresolved: Annotation<string[]>(),
  baseBranch: Annotation<string>(),
  branch: Annotation<string>(),
  prUrl: Annotation<string | null>(),
});
export type State = typeof RunState.State;
type Update = typeof RunState.Update;

export interface GateRequest {
  gate: Gate | 'clarify';
  title: string;
  summary: string;
  artifacts: string[];
  questions?: { question: string; why: string; assumption: string }[];
  tier?: Tier;
}

const section = (title: string, body: string) => (body.trim() ? `## ${title}\n\n${body.trim()}` : '');
const join = (...parts: string[]) => parts.filter(Boolean).join('\n\n');

export function currentReviews(state: State): ReviewResult[] {
  return Object.values(state.reviews).filter((review) => review.round === state.reviewRound);
}

const blocking = (reviews: ReviewResult[]) => reviews.filter((review) => review.verdict === 'request-changes');

export function buildGraph(h: Harness, checkpointer: BaseCheckpointSaver) {
  const roleOf = new Map(TOPOLOGY.nodes.map((node) => [node.id, node.role]));

  /** Wraps a node so entry, exit and failure are always in the audit trail. */
  const work = (id: string, fn: (state: State) => Promise<Update> | Update) => async (state: State): Promise<Update> => {
    const role = roleOf.get(id);
    const started = Date.now();
    h.emit({ type: 'node.entered', node: id, ...(role ? { role } : {}) });
    try {
      const update = await fn(state);
      h.emit({ type: 'node.exited', node: id, ...(role ? { role } : {}), data: { ok: true, durationMs: Date.now() - started } });
      return update;
    } catch (error) {
      h.emit({ type: 'node.exited', node: id, data: { ok: false, durationMs: Date.now() - started, error: (error as Error).message } });
      throw error;
    }
  };

  const ask = (state: State, role: Role, node: string, input: string, access: 'none' | 'read' | 'write' = 'read') => ({
    role,
    node,
    input,
    access,
    tier: state.tier,
    regimes: state.regimes ?? [],
    surfaces: state.surfaces ?? { graphical: false, platforms: ['web' as const] },
  });

  const context = (state: State, names: string[]) =>
    join(
      section('Request', state.request),
      ...names.map((name) => section(name, h.readArtifact(state.artifacts[name]))),
    );

  /**
   * Appended to design documents by the harness, from the agent's structured output, so the
   * guidelines a design claims to follow are always written down where reviewers will check them.
   */
  const guidelineSection = (node: string, role: Role, guidelines: Guideline[]) => {
    h.emit({ type: 'agent.message', node, role, data: { text: `Platform guidelines applied: ${guidelines.map((g) => g.name).join('; ')}`, guidelines } });
    return ['', '## Platform guidelines applied', '', '| Guideline | Applied to |', '|---|---|', ...guidelines.map((g) => `| ${g.url ? `[${g.name}](${g.url})` : g.name} | ${g.applied.replace(/\n/g, ' ')} |`)].join('\n');
  };

  const revision = (state: State, gate: string) =>
    state.feedback[gate] ? section('Revision requested by the approver', state.feedback[gate] ?? '') : '';

  /**
   * A human approval point. It has no side effects before `interrupt`, because LangGraph
   * re-runs the node body from the top when the run resumes.
   */
  const gate = (name: Gate, describe: (state: State) => Omit<GateRequest, 'gate'>) => (state: State): Update => {
    const needsHuman = (gateIsHuman(state.tier, name) || (name === 'release' && state.unresolved.length > 0)) && !h.autoApprove;
    if (!needsHuman) {
      const reason = h.autoApprove ? 'operator ran with --auto-approve' : `tier "${state.tier}" does not require this gate`;
      h.emit({ type: 'gate.resolved', node: `gate_${name}`, data: { gate: name, decision: 'approve', by: 'policy', reason } });
      return { gates: { [name]: { decision: 'approve', by: `policy (${reason})` } }, feedback: { [name]: '' } };
    }
    const decision = interrupt<GateRequest, GateDecision>({ gate: name, ...describe(state) });
    const update: Update = { gates: { [name]: decision }, feedback: { [name]: decision.feedback ?? '' } };
    const tier = decision.answers?.tier as Tier | undefined;
    if (name === 'scope' && tier && tier !== state.tier) {
      update.tier = tier;
      update.tierPinned = true;
      // Runs after the interrupt, so exactly once. Without this record the proposed tier in the
      // analyst's decision would stand uncorrected and mislead every later agent.
      const path = h.recordDecision(`gate_${name}`, 'approver', {
        title: `Tier changed to ${profileFor(tier).label} at the scope gate`,
        context: `The analyst proposed ${profileFor(state.tier).label}. ${state.scopeRationale}`,
        options: [],
        decision: `${profileFor(tier).label}, decided by ${decision.by}. The surface and stack proposed by the analyst stand.`,
        consequences: `${decision.feedback ?? 'No reason was given.'} ${profileFor(tier).intent}`,
      });
      h.commit(`gate_${name}`, 'docs(decisions): tier changed at the scope gate');
      update.decisions = [path];
    }
    return update;
  };

  const afterGate = (name: Gate, approved: string, redo: string) => (state: State) =>
    state.gates[name]?.decision === 'revise' ? redo : approved;

  // ---------------------------------------------------------------- discover

  const intake = work('intake', (state) => {
    const baseBranch = h.git.ensureRepo();
    const branch = `foundry/${h.runId}`;
    h.git.checkoutNew(branch);
    const independence = reviewIndependence(h.config);
    h.emit({ type: 'agent.message', node: 'intake', data: { text: independence.note, independentReview: independence.independent } });
    return {
      baseBranch,
      branch,
      done: [],
      wave: [],
      serial: [],
      stage: 'qa',
      qaResult: null,
      qaRound: 0,
      verifyAttempts: 0,
      reviewRound: 0,
      phase: 'build',
      unresolved: [],
      checks: null,
      prUrl: null,
      clarifications: [],
      tier: state.tier ?? 'prototype',
      surfaces: state.surfaces ?? { graphical: false, platforms: ['web'] },
    };
  });

  const scope = work('scope', async (state) => {
    const { data } = await h.invoke(
      {
        unscoped: true,
        ...ask(
        state,
        'analyst',
        'scope',
        join(
          section('Request', state.request),
          state.tierPinned ? `The operator has fixed the scale tier at "${state.tier}". Classify the surface and stack only, and return that tier.` : '',
          revision(state, 'scope'),
          'Classify this work: scale tier, whether it has a graphical surface, target platforms, and technology stack.',
        ),
        ),
      },
      ScopeSchema,
    );
    const tier = state.tierPinned ? state.tier : data.tier;
    const path = h.recordDecision('scope', 'analyst', {
      title: `Scale tier is ${profileFor(tier).label}`,
      context: `Request: ${state.request}`,
      options: [],
      decision: `${profileFor(tier).label}. Surface: ${data.graphical ? 'graphical' : 'non-graphical'}. Platforms: ${data.platforms.join(', ')}. Stack: ${data.stack.join(', ')}.`,
      consequences: `${data.rationale} ${profileFor(tier).intent}`,
    }, state.tierPinned ? 'Accepted (tier fixed by operator)' : 'Proposed, pending the scope gate', { tier, graphical: data.graphical, platforms: data.platforms, stack: data.stack });
    h.commit('scope', 'docs(decisions): scope and scale tier');
    return {
      tier,
      surfaces: { graphical: data.graphical, platforms: data.platforms },
      stack: data.stack,
      scopeRationale: data.rationale,
      decisions: [path],
    };
  });

  const gateScope = gate('scope', (state) => ({
    title: 'Confirm scope and scale tier',
    summary: `Tier: ${profileFor(state.tier).label}\nSurface: ${state.surfaces.graphical ? 'graphical' : 'non-graphical'} on ${state.surfaces.platforms.join(', ')}\nStack: ${state.stack.join(', ')}\n\n${state.scopeRationale}`,
    artifacts: state.decisions.slice(-1),
    tier: state.tier,
  }));

  const elicit = work('elicit', async (state) => {
    const limit = profileFor(state.tier).maxClarifyingQuestions;
    const { data } = await h.invoke(
      ask(
        state,
        'analyst',
        'elicit',
        join(
          section('Request', state.request),
          `Ask at most ${limit} clarifying questions: only those whose answers would change what gets built. For each, state the assumption you will proceed on if it goes unanswered.`,
        ),
      ),
      ElicitSchema,
    );
    return { questions: data.questions.slice(0, limit) };
  });

  const gateClarify = (state: State): Update => {
    if (state.questions.length === 0) return { clarifications: [] };
    if (h.autoApprove) {
      h.emit({ type: 'gate.resolved', node: 'gate_clarify', data: { gate: 'clarify', decision: 'approve', by: 'policy', reason: 'unattended run; proceeding on stated assumptions' } });
      return { clarifications: state.questions.map((q) => ({ question: q.question, answer: q.assumption, source: 'assumed' as const })) };
    }
    const reply = interrupt<GateRequest, GateDecision>({
      gate: 'clarify',
      title: 'Questions before requirements are written',
      summary: 'Answer what you can. A blank answer accepts the stated assumption.',
      artifacts: [],
      questions: state.questions,
    });
    return {
      clarifications: state.questions.map((q, index) => {
        const answer = reply.answers?.[String(index)]?.trim();
        return answer ? { question: q.question, answer, source: 'human' as const } : { question: q.question, answer: q.assumption, source: 'assumed' as const };
      }),
    };
  };

  const requirements = work('requirements', async (state) => {
    const answers = state.clarifications
      .map((c) => `- **${c.question}**\n  ${c.answer} _(${c.source === 'human' ? 'answered' : 'assumption'})_`)
      .join('\n');
    const { body } = await h.invoke(
      ask(
        state,
        'product',
        'requirements',
        join(
          section('Request', state.request),
          section('Clarifications', answers),
          revision(state, 'requirements'),
          'Write the Product Requirements Document as markdown. Number every requirement (FR-n, NFR-n) and give each acceptance criteria. List assumptions and non-goals explicitly.',
        ),
      ),
      SummarySchema,
    );
    const path = h.writeArtifact('requirements', 'docs/product/PRD.md', body);
    h.commit('requirements', 'docs(product): requirements');
    return { artifacts: { 'Product requirements': path } };
  });

  const gateRequirements = gate('requirements', (state) => ({
    title: 'Approve the product requirements',
    summary: 'Everything downstream is built and reviewed against this document.',
    artifacts: [state.artifacts['Product requirements'] ?? ''],
  }));

  // -------------------------------------------------------------- compliance

  const compliance = work('compliance', async (state) => {
    const { body, data } = await h.invoke(
      ask(
        state,
        'compliance',
        'compliance',
        join(
          context(state, ['Product requirements']),
          revision(state, 'compliance'),
          'Assess this product. Write a short assessment as markdown: what data it handles and what follows from that. Then return the data categories and, for every regime in the compliance standard, whether it applies, why, the obligations that follow, the right tool for each, and what change to the product would alter the answer. List the facts you need from the approver for anything uncertain.',
        ),
      ),
      ComplianceSchema,
    );
    const production = state.tier !== 'prototype';
    // An undecided regime is treated as applicable at production tiers: build for it until a person rules it out.
    const applicable = data.regimes.filter((r) => r.applies === 'yes' || (production && r.applies === 'uncertain'));
    const cell = (text: string) => text.replace(/\n/g, ' ').replace(/\|/g, '/');
    const document = [
      body,
      '',
      '## Data inventory',
      '',
      ...(data.dataCategories.length ? ['| Category | Examples | Stored | Notes |', '|---|---|---|---|', ...data.dataCategories.map((d) => `| ${cell(d.category)} | ${cell(d.examples)} | ${d.stored ? 'yes' : 'no'} | ${cell(d.notes)} |`)] : ['No regulated data categories were identified.']),
      '',
      '## Applicability',
      '',
      '| Regime | Applies | Why | Reassess if |',
      '|---|---|---|---|',
      ...data.regimes.map((r) => `| ${cell(r.name)} | ${r.applies} | ${cell(r.reason)} | ${cell(r.reassessIf)} |`),
      '',
      ...applicable.flatMap((r) => [`## Obligations: ${r.name}`, '', ...r.obligations.map((o) => `- ${o}`), '', ...(r.rightTools.length ? ['**Right tools**', '', ...r.rightTools.map((t) => `- ${t}`), ''] : [])]),
      ...(data.questions.length ? ['## Questions for the approver', '', ...data.questions.map((q) => `- ${q}`), ''] : []),
      '## Every project',
      '',
      `A software bill of materials (\`${SBOM_FILE}\`) and an open source licence review are produced for every build, at every tier. See \`docs/compliance/SBOM-REPORT.md\`.`,
      '',
      '_This assessment is an engineering working position produced by an AI agent. It is not legal advice. A qualified person must confirm it before production use._',
    ].join('\n');
    const path = h.writeArtifact('compliance', 'docs/compliance/COMPLIANCE-ASSESSMENT.md', document);
    const decision = h.recordDecision('compliance', 'compliance', {
      title: applicable.length ? `Compliance scope: ${applicable.map((r) => r.name).join(', ')}` : 'Compliance scope: no regulatory regime applies',
      context: data.summary,
      options: [],
      decision: data.regimes.map((r) => `${r.name}: ${r.applies}. ${r.reason}`).join(' '),
      consequences: applicable.length ? `The control packs for ${applicable.map((r) => r.id).join(', ')} are added to design, build, QA and review. Reassess when scope changes.` : `Only the universal SBOM and licence checks apply. Reassess if: ${data.regimes.map((r) => r.reassessIf).filter(Boolean).join('; ') || 'the data handled changes'}.`,
    });
    h.commit('compliance', 'docs(compliance): applicability assessment');
    return { regimes: applicable.map((r) => r.id), artifacts: { 'Compliance assessment': path }, decisions: [decision] };
  });

  const gateCompliance = gate('compliance', (state) => ({
    title: 'Confirm the compliance assessment',
    summary: `${state.regimes.length ? `Treated as applicable: ${state.regimes.join(', ')}.` : 'No regulatory regime was found to apply.'}\nThis is an AI agent's working position, not legal advice. Approve only if you, or the person responsible for compliance, agree with it.`,
    artifacts: [state.artifacts['Compliance assessment'] ?? ''],
  }));

  // ------------------------------------------------------------------ design

  const ux = work('ux', async (state) => {
    const { body, data } = await h.invoke(
      ask(
        state,
        'ux',
        'ux',
        join(
          context(state, ['Product requirements']),
          revision(state, 'ux'),
          'Write the UX specification as markdown: users and their jobs, key flows, information architecture, every screen state (empty, loading, error, offline where relevant), accessibility commitments, and design tokens. Consult the official design guidelines for every target platform and design to them; return each one you relied on, with the sections applied.',
        ),
      ),
      UxSchema,
    );
    const path = h.writeArtifact('ux', 'docs/ux/UX-SPEC.md', body + guidelineSection('ux', 'ux', data.guidelines));
    h.commit('ux', 'docs(ux): experience specification');
    return { artifacts: { 'UX specification': path } };
  });

  const gateUx = gate('ux', (state) => ({
    title: 'Approve the UX specification',
    summary: 'Architecture is designed to serve this experience, not the other way round.',
    artifacts: [state.artifacts['UX specification'] ?? ''],
  }));

  const architecture = work('architecture', async (state) => {
    const { body, data } = await h.invoke(
      ask(
        state,
        'architect',
        'architecture',
        join(
          context(state, ['Product requirements', 'Compliance assessment', 'UX specification']),
          section('Agreed stack', state.stack.join(', ')),
          revision(state, 'architecture'),
          state.consultRound > 0
            ? join(
                section('Your draft', h.readArtifact(state.artifacts.Architecture)),
                section('What the domain experts said about it', h.readArtifact(state.artifacts['Expert review'])),
                'Revise the design. Address every expert finding: adopt it, or keep your decision and say why in the document. Do not ask for further consultation.',
              )
            : `You may have domain experts challenge specific decisions before the design is final: at most ${profileFor(state.tier).maxExperts} at this tier, and only where a decision is risky, unfamiliar or expensive to reverse. Return them as consults, each with the topic and the exact questions. Experts on file: ${expertCatalogue().join(', ')}. Any other domain can be named in plain words. Return none if the design does not need it.`,
          'Write the architecture document as markdown, sized to the scale tier. Return every significant choice as a decision record with the options you rejected. Any departure from the stack policy or the tier standard needs its own decision record. Return the official platform and language guidelines the design follows, with the sections applied. Return a performance budget with measurable targets, and every third-party dependency with what the platform could not do, its runtime cost, and the evidence that it is mature and security tested. Prefer none.',
        ),
      ),
      DesignSchema,
    );
    if (data.guidelines.length === 0) throw new Error('The architect named no platform or language guidelines; the architecture cannot be accepted without them.');
    if (data.performanceBudget.length === 0) throw new Error('The architect set no performance budget; the architecture cannot be accepted without one.');
    const cell = (text: string) => text.replace(/\n/g, ' ').replace(/\|/g, '/');
    const technology = [
      '',
      '## Performance budget',
      '',
      '| Metric | Target |',
      '|---|---|',
      ...data.performanceBudget.map((b) => `| ${cell(b.metric)} | ${cell(b.target)} |`),
      '',
      '## Third-party dependencies',
      '',
      ...(data.dependencies.length
        ? ['| Dependency | Purpose | What the platform could not do | Runtime cost | Maturity and security |', '|---|---|---|---|---|', ...data.dependencies.map((d) => `| ${cell(d.name)} | ${cell(d.purpose)} | ${cell(d.whyNotPlatform)} | ${cell(d.cost)} | ${cell(d.maturity)} |`)]
        : ['None. The design uses only the language standard library and the platform frameworks.']),
      '',
      'A dependency that appears in the code but not in this table is a review finding.',
    ].join('\n');
    h.emit({ type: 'agent.message', node: 'architecture', role: 'architect', data: { text: `Third-party dependencies: ${data.dependencies.length ? data.dependencies.map((d) => d.name).join(', ') : 'none'}`, dependencies: data.dependencies, performanceBudget: data.performanceBudget } });
    const path = h.writeArtifact('architecture', 'docs/architecture/ARCHITECTURE.md', body + technology + guidelineSection('architecture', 'architect', data.guidelines));
    // First pass with consultations requested: this is a draft. Decisions are recorded only once the experts have been heard.
    const consults = state.consultRound === 0 ? data.consults.slice(0, profileFor(state.tier).maxExperts) : [];
    if (consults.length > 0) {
      h.commit('architecture', 'docs(architecture): draft for expert review');
      return { artifacts: { Architecture: path }, consults };
    }
    const decisions = data.decisions.map((record) => h.recordDecision('architecture', 'architect', record));
    h.commit('architecture', 'docs(architecture): design and decision records');
    return { artifacts: { Architecture: path }, decisions, consults: [] };
  });

  const expertPanel = work('expert_panel', async (state) => {
    // Every expert reads the same draft at the same time, each in a fresh context with its own brief.
    const settled = await Promise.allSettled(
      state.consults.map((consult) =>
        h.invoke(
          {
            ...ask(
              state,
              'expert',
              'expert_panel',
              join(
                context(state, ['Product requirements', 'Architecture']),
                section(`You are consulted on: ${consult.topic}`, consult.questions.map((q) => `- ${q}`).join('\n') || 'Review the decisions in your domain.'),
                'Give your verdict on this part of the design for this product at this tier. Check current official documentation for the versions named.',
              ),
            ),
            expert: consult.expert,
            tag: consult.expert.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          },
          ExpertSchema,
        ),
      ),
    );
    const cell = (text: string) => text.replace(/\n/g, ' ').replace(/\|/g, '/');
    const sections = state.consults.flatMap((consult, index) => {
      const outcome = settled[index] as PromiseSettledResult<{ data: { verdict: string; summary: string; findings: { severity: string; summary: string; recommendation: string }[]; sources: string[] }; model: string }>;
      if (outcome.status === 'rejected') {
        h.emit({ type: 'agent.message', node: 'expert_panel', role: 'expert', data: { text: `Expert ${consult.expert} could not be consulted: ${String(outcome.reason?.message ?? outcome.reason).slice(0, 300)}` } });
        return [`## ${consult.expert}: not consulted`, '', `The consultation failed: ${String(outcome.reason?.message ?? outcome.reason).slice(0, 300)}`, ''];
      }
      const { data, model } = outcome.value;
      h.emit({ type: 'agent.message', node: 'expert_panel', role: 'expert', agent: `expert@${consult.expert}`, data: { text: `${consult.expert}: ${data.verdict}, ${data.findings.length} finding(s) on ${consult.topic}`, expert: consult.expert, verdict: data.verdict, findings: data.findings.length } });
      return [
        `## ${consult.expert}: ${data.verdict}`,
        '',
        `Topic: ${consult.topic}. Model: \`${model}\`.`,
        '',
        data.summary,
        '',
        ...(data.findings.length ? ['| Severity | Finding | Recommendation |', '|---|---|---|', ...data.findings.map((f) => `| ${f.severity} | ${cell(f.summary)} | ${cell(f.recommendation)} |`)] : ['No findings.']),
        '',
        ...(data.sources.length ? [`Sources checked: ${data.sources.map(cell).join('; ')}`, ''] : []),
      ];
    });
    const path = h.writeArtifact('expert_panel', 'docs/architecture/EXPERT-REVIEW.md', ['# Expert review of the draft architecture', '', `Run \`${h.runId}\`. The architect asked ${state.consults.length} domain expert(s) to challenge specific decisions. The architect's response to each finding is in the architecture document.`, '', ...sections].join('\n'));
    h.commit('expert_panel', 'docs(architecture): expert review of the draft');
    return { consultRound: 1, artifacts: { 'Expert review': path } };
  });

  const gateArchitecture = gate('architecture', (state) => ({
    title: 'Approve the architecture',
    summary: `Decision records: ${state.decisions.length}.${state.artifacts['Expert review'] ? ' Domain experts reviewed the draft; see the expert review.' : ''}`,
    artifacts: [state.artifacts.Architecture ?? '', state.artifacts['Expert review'] ?? '', ...state.decisions],
  }));

  const threatModel = work('threat_model', async (state) => {
    const { body, data } = await h.invoke(
      ask(
        state,
        'security',
        'threat_model',
        join(
          context(state, ['Product requirements', 'Compliance assessment', 'Architecture']),
          revision(state, 'threat-model'),
          'Write the threat model as markdown: assets, trust boundaries, STRIDE threats, and the control for each. Map controls to the security standard and call out anything the architecture is missing.',
        ),
      ),
      DesignSchema,
    );
    const path = h.writeArtifact('threat_model', 'docs/security/THREAT-MODEL.md', body);
    const decisions = data.decisions.map((record) => h.recordDecision('threat_model', 'security', record));
    h.commit('threat_model', 'docs(security): threat model');
    return { artifacts: { 'Threat model': path }, decisions };
  });

  const gateThreat = gate('threat-model', (state) => ({
    title: 'Approve the threat model',
    summary: 'Controls listed here become review criteria for the security reviewer.',
    artifacts: [state.artifacts['Threat model'] ?? ''],
  }));

  const plan = work('plan', async (state) => {
    const { data } = await h.invoke(
      ask(
        state,
        'planner',
        'plan',
        join(
          context(state, ['Product requirements', 'Compliance assessment', 'UX specification', 'Architecture', 'Threat model']),
          state.feedback.plan ? section('Re-planning', `${state.feedback.plan}\n\nInspect the repository first. Work that already exists and passes its checks is done: do not plan it again. Plan only what remains.`) : '',
          'Break the work into small, independently verifiable tasks in build order. Every task traces to requirement ids and has testable acceptance criteria. Every requirement must be covered by at least one task. Give each task a track, its real dependencies, a size and a risk, so independent tiers and platforms can be built in parallel.',
        ),
      ),
      PlanSchema,
    );
    const markdown = [
      '# Implementation Plan',
      '',
      ...data.tasks.flatMap((task) => [
        `## ${task.id}. ${task.title}`,
        '',
        task.description,
        '',
        `**Track:** ${task.track}${task.platform ? ` (${task.platform})` : ''} | **Size:** ${task.size} | **Risk:** ${task.risk} | **Depends on:** ${task.dependsOn.join(', ') || 'nothing'}`,
        '',
        `**Requirements:** ${task.requirements.join(', ') || 'none listed'}`,
        '',
        '**Acceptance**',
        ...task.acceptance.map((item) => `- [ ] ${item}`),
        '',
      ]),
    ].join('\n');
    const path = h.writeArtifact('plan', 'docs/plan/TASKS.md', markdown);
    h.commit('plan', 'docs(plan): task breakdown');
    return { tasks: data.tasks, done: [], wave: [], serial: [], artifacts: { Plan: path } };
  });

  // ------------------------------------------------------------------- build

  const failures = (state: State) =>
    state.checks && !state.checks.ok
      ? section(
          'Verification failed on your last attempt',
          state.checks.steps
            .filter((step) => step.exitCode !== 0)
            .map((step) => `\`${step.command}\` exited ${step.exitCode}\n\n\`\`\`\n${step.output}\n\`\`\``)
            .join('\n\n'),
        )
      : '';

  const taskPrompt = (state: State, task: PlanTask, extra = '') =>
    join(
      context(state, ['Product requirements', 'UX specification', 'Architecture', 'Threat model']),
      section(
        `Your task: ${task.id}. ${task.title}`,
        `${task.description}\n\nTrack: ${task.track}. Change only files this track owns.\nRequirements: ${task.requirements.join(', ')}\n\nAcceptance:\n${task.acceptance.map((a) => `- ${a}`).join('\n')}`,
      ),
      extra,
      'Implement this task only, with the tests the testing standard calls for at this tier. Run the checks for your part of the project before you finish. Do not commit; the harness commits your work.',
    );

  /** The agent building one task sees only the standards of the platform that task targets. */
  const surfacesFor = (state: State, task: PlanTask): Surfaces => (task.platform ? { graphical: state.surfaces.graphical, platforms: [task.platform] } : state.surfaces);

  const implement = work('implement', async (state) => {
    // Verification of the last wave failed: one developer repairs it on the merged tree.
    if (state.phase === 'build' && state.checks && !state.checks.ok && state.wave.length > 0) {
      const tasks = state.tasks.filter((task) => state.wave.includes(task.id));
      await h.invoke(
        ask(
          state,
          'developer',
          'implement',
          join(
            context(state, ['Product requirements', 'Architecture']),
            section('Tasks just merged', tasks.map((task) => `- ${task.id} (${task.track}): ${task.title}`).join('\n')),
            failures(state),
            'The project checks fail after these tasks were merged. Find the cause and fix it with the smallest correct change. Never weaken a check. Do not commit.',
          ),
          'write',
        ),
      );
      h.commit('implement', `fix(build): repair checks after ${state.wave.join(', ')}`);
      return { verifyAttempts: state.verifyAttempts + 1 };
    }

    const wave = nextWave(state.tasks, new Set(state.done), state.serial, h.config.dispatch.maxParallel);
    // A task being retried after a failure or conflict goes to the developer default, not back to
    // the runner that may have caused the failure.
    const assignments = assign(h.config, wave).map((a) =>
      state.serial.includes(a.task.id) ? { ...a, runner: h.runnerFor('developer').name, reason: 'retry after a failed or conflicting parallel attempt; developer default' } : a,
    );
    const remaining = state.tasks.length - state.done.length;
    h.emit({
      type: 'dispatch.planned',
      node: 'implement',
      data: {
        parallel: assignments.length,
        maxParallel: h.config.dispatch.maxParallel,
        remaining,
        ...(wave.note ? { note: wave.note } : {}),
        assignments: assignments.map((a) => ({ task: a.task.id, title: a.task.title, track: a.task.track, size: a.task.size, risk: a.task.risk, runner: a.runner, reason: a.reason })),
      },
    });

    const base = { role: 'developer' as const, node: 'implement', access: 'write' as const, tier: state.tier };

    // One task: work directly on the run branch. No worktree, nothing to merge.
    if (assignments.length === 1) {
      const { task, runner } = assignments[0] as (typeof assignments)[number];
      const retry = state.serial.includes(task.id) ? section('Note', `An earlier attempt at this task was made in parallel with others and could not be merged. Branch foundry-task/${h.runId}/${task.id} holds that attempt for reference. Implement the task again on the current tree.`) : '';
      await h.invoke({ ...base, input: taskPrompt(state, task, retry), surfaces: surfacesFor(state, task), runner, tag: task.track, meta: { taskId: task.id } });
      h.commit('implement', `feat(${task.id}): ${task.title}`);
      return { phase: 'build', wave: [task.id], serial: state.serial.filter((id) => id !== task.id), verifyAttempts: 1, checks: null };
    }

    // Several tasks: each agent gets its own worktree and branch, so they cannot disturb each other.
    h.commit('implement', 'chore: checkpoint before parallel work');
    const jobs = assignments.map((a) => {
      const branch = `foundry-task/${h.runId}/${a.task.id}`;
      const dir = joinPath(h.projectDir, '.foundry', 'worktrees', h.runId, a.task.id);
      h.git.worktreeAdd(dir, branch);
      return { ...a, branch, dir };
    });
    const settled = await Promise.allSettled(
      jobs.map((job) =>
        h.invoke({ ...base, input: taskPrompt(state, job.task), surfaces: surfacesFor(state, job.task), runner: job.runner, tag: job.task.track, cwd: job.dir, meta: { taskId: job.task.id } }),
      ),
    );

    const merged: string[] = [];
    const again: string[] = [];
    for (const [index, job] of jobs.entries()) {
      const outcome = settled[index] as PromiseSettledResult<unknown>;
      if (outcome.status === 'rejected') {
        h.emit({ type: 'agent.message', node: 'implement', role: 'developer', data: { text: `${job.task.id} failed and will be retried alone: ${String(outcome.reason?.message ?? outcome.reason).slice(0, 300)}`, task: job.task.id } });
        again.push(job.task.id);
      } else {
        const sha = new Git(job.dir).commitAll(`feat(${job.task.id}): ${job.task.title}`, { 'Foundry-Run': h.runId, 'Foundry-Node': 'implement', 'Foundry-Track': job.task.track });
        // Merge in plan order. The first conflict loses nothing: that task is redone alone on the merged tree.
        if (h.git.merge(job.branch, `merge(${job.task.id}): ${job.task.title}`)) {
          merged.push(job.task.id);
          h.emit({ type: 'git.commit', node: 'implement', data: { sha: sha ?? 'no changes', message: `merged ${job.task.id} from track ${job.task.track}` } });
        } else {
          h.emit({ type: 'agent.message', node: 'implement', role: 'developer', data: { text: `${job.task.id} conflicted with another track on merge and will be redone alone.`, task: job.task.id, conflict: true } });
          again.push(job.task.id);
        }
      }
      h.git.worktreeRemove(job.dir);
      if (merged.includes(job.task.id)) h.git.deleteBranch(job.branch);
    }
    if (merged.length === 0 && settled.every((o) => o.status === 'rejected')) {
      throw new Error(`Every agent in the wave failed: ${String((settled[0] as PromiseRejectedResult).reason?.message).slice(0, 500)}`);
    }
    return { phase: 'build', wave: merged, serial: [...new Set([...state.serial, ...again])], verifyAttempts: 1, checks: null };
  });

  const verify = work('verify', (state) => {
    const commands = h.config.verify.commands.length ? h.config.verify.commands : detectVerifyCommands(h.projectDir);
    const result = runVerify(h.projectDir, commands, h.config.verify.timeoutSec);
    h.emit({
      type: 'verify.result',
      node: 'verify',
      data: {
        ok: result.ok,
        configured: commands.length > 0,
        steps: result.steps.map((s) => ({ command: s.command, exitCode: s.exitCode, durationMs: s.durationMs })),
      },
    });
    const max = profileFor(state.tier).maxVerifyAttempts;
    if (!result.ok) {
      const exhausted = state.verifyAttempts >= max;
      return { checks: result, ...(exhausted ? { unresolved: [...state.unresolved, `Verification still failing after ${max} attempts`] } : {}) };
    }
    const noChecks = commands.length === 0 && !state.unresolved.includes('No verification commands were found or configured');
    return {
      checks: result,
      verifyAttempts: 0,
      ...(state.phase === 'build' ? { done: [...state.done, ...state.wave], wave: [] } : {}),
      ...(noChecks ? { unresolved: [...state.unresolved, 'No verification commands were found or configured'] } : {}),
    };
  });

  const afterVerify = (state: State) => {
    const redo = state.phase === 'build' ? 'implement' : 'fix';
    if (!state.checks?.ok) return state.verifyAttempts >= profileFor(state.tier).maxVerifyAttempts ? 'gate_release' : redo;
    if (state.phase === 'fix') return state.stage === 'review' ? 'sbom' : 'qa';
    return state.done.length < state.tasks.length ? 'implement' : 'document';
  };

  const document = work('document', async (state) => {
    const required = profileFor(state.tier).requiredDocs;
    const { body } = await h.invoke(
      ask(
        state,
        'writer',
        'document',
        join(
          context(state, ['Product requirements', 'Architecture', 'Plan']),
          section('Changed files', h.git.diffStat(state.baseBranch)),
          `Write or update: ${required.join(', ')}. Return each file in full between \`=== FILE: <path> ===\` and \`=== END FILE ===\` lines. Only README.md, CHANGELOG.md and files under docs/ are accepted.`,
        ),
      ),
    );
    for (const file of parseFileBlocks(body)) {
      const allowed = /^(README\.md|CHANGELOG\.md|docs\/[\w./-]+\.md)$/.test(file.path) && !file.path.includes('..');
      if (allowed) h.writeArtifact('document', file.path, file.content);
      else h.emit({ type: 'policy.denied', node: 'document', role: 'writer', data: { tool: 'Write', detail: file.path, reason: 'Writer may only produce documentation files' } });
    }
    h.commit('document', 'docs: user and operations documentation');
    return {};
  });

  // ---------------------------------------------------------------------- qa

  const qa = work('qa', async (state) => {
    const profile = profileFor(state.tier);
    const round = state.qaRound + 1;
    const prd = h.readArtifact(state.artifacts['Product requirements']);
    const required = [...new Set(prd.match(/\bFR-\d+\b/g) ?? [])];
    const { data, runner, model } = await h.invoke(
      {
        ...ask(
          state,
          'qa',
          'qa',
          join(
            context(state, ['Product requirements', 'Compliance assessment', 'UX specification', 'Architecture', 'Plan']),
            section('Verification status', state.checks?.ok ? 'The project checks pass.' : 'The project checks are failing or not configured.'),
            state.qaResult ? section('Defects you reported last round', state.qaResult.defects.map((d) => `- [${d.severity}] ${d.summary}`).join('\n') || 'None.') : '',
            `Test this build against the requirements. Return one case per requirement you checked, citing its id, with the evidence. ${profile.qaRequiresFullCoverage ? 'At this tier every functional requirement needs a result.' : 'At this tier cover the critical flows and functions; mark the rest not-run with the reason.'} Do not change product code.`,
          ),
          'write',
        ),
        meta: { round },
      },
      QaSchema,
    );
    // Requirements the tester did not mention are recorded as not run, so the gap is visible instead of silent.
    const covered = new Set(data.cases.flatMap((c) => c.requirement.match(/\b(?:FR|NFR)-\d+\b/g) ?? []));
    const cases = [...data.cases, ...required.filter((id) => !covered.has(id)).map((id) => ({ requirement: id, check: 'Not addressed by the tester', result: 'not-run' as const, evidence: '' }))];
    const failed = cases.filter((c) => c.result === 'fail');
    const untested = cases.filter((c) => c.result === 'not-run' && /\bFR-\d+\b/.test(c.requirement));
    const blockers = data.defects.filter((d) => d.severity === 'blocker' || d.severity === 'major');
    const fail = failed.length > 0 || blockers.length > 0 || (profile.qaRequiresFullCoverage && untested.length > 0);
    const result: QaResult = { round, verdict: fail ? 'fail' : 'pass', summary: data.summary, cases, defects: data.defects, tester: { runner, model } };

    const cell = (text: string) => text.replace(/\n/g, ' ').replace(/\|/g, '/');
    const report = [
      `# QA report, round ${round}`,
      '',
      `Run \`${h.runId}\`. Verdict: **${result.verdict}**. Tester: \`${model}\` via \`${runner}\`.`,
      '',
      data.summary,
      '',
      `Passed ${cases.filter((c) => c.result === 'pass').length}, failed ${failed.length}, not run ${cases.filter((c) => c.result === 'not-run').length}.${profile.qaRequiresFullCoverage ? ' At this tier an untested functional requirement fails QA.' : ''}`,
      '',
      '## Requirement traceability',
      '',
      '| Requirement | Check | Result | Evidence |',
      '|---|---|---|---|',
      ...cases.map((c) => `| ${cell(c.requirement)} | ${cell(c.check)} | ${c.result} | ${cell(c.evidence)} |`),
      '',
      '## Defects',
      '',
      ...(data.defects.length ? ['| Severity | Location | Defect | Expected |', '|---|---|---|---|', ...data.defects.map((d) => `| ${d.severity} | ${d.file ? `\`${d.file}${d.line ? `:${d.line}` : ''}\`` : ''} | ${cell(d.summary)} | ${cell(d.recommendation)} |`)] : ['None found.']),
    ].join('\n');
    const path = h.writeArtifact('qa', `docs/qa/${h.runId}-round-${round}.md`, report);
    h.commit('qa', `docs(qa): round ${round}`);
    h.emit({ type: 'qa.verdict', node: 'qa', role: 'qa', data: { round, verdict: result.verdict, passed: cases.length - failed.length - cases.filter((c) => c.result === 'not-run').length, failed: failed.length, notRun: cases.filter((c) => c.result === 'not-run').length, defects: data.defects.length, model } });
    const exhausted = fail && round >= profile.maxQaRounds;
    return {
      qaResult: result,
      qaRound: round,
      stage: 'qa',
      artifacts: { [`QA round ${round}`]: path },
      ...(exhausted ? { unresolved: [...state.unresolved, `QA still failing after ${round} rounds (${failed.length} failed checks, ${blockers.length} blocking defects)`] } : {}),
    };
  });

  const afterQa = (state: State) => {
    if (state.qaResult?.verdict === 'fail' && state.qaRound < profileFor(state.tier).maxQaRounds) return 'fix';
    // Usability testing needs people and an interface. Without an interface there is nothing to observe.
    return state.surfaces.graphical ? 'usability_prep' : 'sbom';
  };

  const usabilityPrep = work('usability_prep', async (state) => {
    if (state.artifacts['Usability test plan']) return {};
    const { body } = await h.invoke(
      ask(
        state,
        'ux',
        'usability_prep',
        join(
          context(state, ['Product requirements', 'UX specification']),
          section('How to run the build', h.readArtifact('README.md', 6000)),
          'Write a usability test plan a person can run with real participants in under an hour: who to recruit, how to set up the build, three to five realistic tasks worded without leading the participant, the success measure for each (taken from the goals in the requirements), an observation sheet, and the questions to ask afterwards. Size it to the tier.',
        ),
      ),
      SummarySchema,
    );
    const path = h.writeArtifact('usability_prep', 'docs/ux/USABILITY-TEST.md', body);
    h.commit('usability_prep', 'docs(ux): usability test plan');
    return { artifacts: { 'Usability test plan': path } };
  });

  const gateUsability = gate('usability', (state) => ({
    title: 'Usability test with real people',
    summary: [
      'Automated checks and QA cannot tell you whether people can use this. Run the test plan with real participants on the current build.',
      'Approve when it passes. Revise with what you observed and the developer will rework it, after which QA runs again.',
      'To proceed without testing, approve and say so in the feedback; that is recorded as your decision.',
      state.qaResult ? `QA round ${state.qaResult.round}: ${state.qaResult.verdict}.` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    artifacts: [state.artifacts['Usability test plan'] ?? '', state.branch],
  }));

  // -------------------------------------------------------------------- sbom

  /** Deterministic: an established tool generates the SBOM and the harness itself checks it. No model is involved. */
  const sbom = work('sbom', (state) => {
    const round = state.sbomRound + 1;
    const production = state.tier !== 'prototype';
    const { bom, error, command } = generateSbom(h.projectDir, h.config);
    const report: SbomReport = bom
      ? { generated: true, file: SBOM_FILE, ...analyseSbom(bom, h.config) }
      : { generated: false, error: error ?? 'unknown error', file: SBOM_FILE, format: '', specVersion: '', components: [], checks: [], denied: [], needsReview: [], unlicensed: [] };

    if (report.generated) {
      h.emit({ type: 'artifact.written', node: 'sbom', data: { path: SBOM_FILE, components: report.components.length, format: `${report.format} ${report.specVersion}` } });
      h.writeArtifact('sbom', 'THIRD-PARTY-NOTICES.md', renderNotices(report, state.request.split('\n')[0]?.slice(0, 80) ?? 'This product'));
    }
    const path = h.writeArtifact('sbom', 'docs/compliance/SBOM-REPORT.md', renderSbomReport(report, h.runId, command));
    h.commit('sbom', 'chore(compliance): software bill of materials and licence report');

    const failedChecks = report.checks.filter((c) => !c.ok);
    const notes: string[] = [];
    if (!report.generated) notes.push(`No SBOM was produced: ${report.error}`);
    if (report.denied.length && round >= 2) notes.push(`${report.denied.length} shipped component(s) use a licence the policy forbids`);
    if (production && failedChecks.length) notes.push(`SBOM misses the EU baseline on: ${failedChecks.map((c) => c.name.toLowerCase()).join('; ')}`);
    if (production && (report.needsReview.length || report.unlicensed.length)) notes.push(`${report.needsReview.length + report.unlicensed.length} shipped component(s) need a person to review their licence`);
    h.emit({
      type: 'sbom.result',
      node: 'sbom',
      data: { generated: report.generated, format: `${report.format} ${report.specVersion}`.trim(), components: report.components.length, checksFailed: failedChecks.map((c) => c.name), denied: report.denied.length, needsReview: report.needsReview.length, unlicensed: report.unlicensed.length, ...(report.error ? { error: report.error.slice(0, 400) } : {}) },
    });
    const keep = state.unresolved.filter((u) => !/SBOM|licence/.test(u));
    return {
      sbomRound: round,
      licenseViolations: report.denied.map((d) => `${d.component} (${d.license})`),
      artifacts: { 'SBOM report': path },
      unresolved: [...keep, ...notes],
    };
  });

  /** A forbidden licence gets one round of rework (replace the dependency) before it is escalated to a person. */
  const afterSbom = (state: State) => (state.licenseViolations.length > 0 && state.sbomRound < 2 ? 'fix' : 'publish');

  // ------------------------------------------------------------------ review

  const publish = work('publish', (state) => {
    h.commit('publish', 'chore: prepare for review');
    let prUrl = state.prUrl;
    const wanted = h.config.github.openPullRequest && h.git.hasRemote();
    if (wanted && h.github.available()) {
      const pushed = h.git.push(state.branch);
      if (pushed.code !== 0) {
        h.emit({ type: 'agent.message', node: 'publish', data: { text: `Push failed: ${pushed.stderr.trim().slice(0, 300)}` } });
      } else if (!prUrl) {
        prUrl = h.github.existingPr(state.branch);
        if (!prUrl) {
          const body = [
            `Run \`${h.runId}\`, tier **${profileFor(state.tier).label}**.`,
            '',
            state.request,
            '',
            '### Trace',
            ...Object.entries(state.artifacts).map(([name, path]) => `- ${name}: \`${path}\``),
            `- Decision records: ${state.decisions.length} under \`docs/decisions/\``,
            '',
            'Opened by Foundry. AI reviews are posted below as comments. A human merges.',
          ].join('\n');
          prUrl = h.github.createPr({ title: state.request.split('\n')[0]?.slice(0, 70) ?? 'Foundry run', body, base: state.baseBranch, draft: h.config.github.draft });
        }
        h.emit({ type: 'pr.opened', node: 'publish', data: { url: prUrl, branch: state.branch, base: state.baseBranch } });
      }
    } else {
      h.emit({
        type: 'agent.message',
        node: 'publish',
        data: { text: wanted ? 'gh is not authenticated; reviewing the local branch only.' : 'No remote pull request; reviewing the local branch diff.' },
      });
    }
    return { prUrl, reviewRound: state.reviewRound + 1, stage: 'review' };
  });

  const review = (lens: ReviewLens) =>
    work(`review_${lens}`, async (state) => {
      const full = h.git.diff(state.baseBranch);
      const limit = h.config.review.maxDiffChars;
      const diff = full.length > limit ? `${full.slice(0, limit)}\n\n[diff truncated at ${limit} characters; inspect the workspace for the rest]` : full;
      const earlier = Object.values(state.reviews).filter((r) => r.lens === lens && r.round < state.reviewRound);
      const input = join(
              context(state, lens === 'ux' ? ['Product requirements', 'UX specification'] : lens === 'security' ? ['Product requirements', 'Compliance assessment', 'Threat model'] : lens === 'compliance' ? ['Product requirements', 'Compliance assessment', 'SBOM report'] : ['Product requirements', 'Architecture']),
              earlier.length ? section('Your findings from earlier rounds', earlier.flatMap((r) => r.findings.map((f) => `- [${f.severity}] ${f.summary}`)).join('\n')) : '',
              section('Verification status', state.checks?.ok ? 'All configured checks pass.' : 'Checks are failing or not configured.'),
              section('Pull request diff', `\`\`\`diff\n${diff}\n\`\`\``),
              'Review this pull request. Check it against the platform guidelines listed in the design documents; a departure from one without a decision record is a major finding. A third-party dependency that is missing from the dependency table in the architecture, or a change that threatens the performance budget, is also a major finding. Request changes only for blocker or major findings; record minor points and nits without blocking.',
            );
      // Every configured reviewer examines this lens at the same time, each in its own fresh context.
      const names = reviewRunners(h.config);
      const ensemble = h.config.review.ensemble.length > 0;
      const settled = await Promise.allSettled(
        names.map((name) =>
          h.invoke({ ...ask(state, 'reviewer', `review_${lens}`, input), lens, ...(ensemble ? { runner: name } : {}), meta: { lens, round: state.reviewRound } }, ReviewSchema),
        ),
      );
      const opinions = settled.flatMap((outcome, index) => {
        if (outcome.status === 'fulfilled') return [outcome.value];
        // One reviewer being unavailable must not sink the run while another can still review.
        h.emit({ type: 'agent.message', node: `review_${lens}`, role: 'reviewer', data: { text: `Reviewer ${names[index]} failed and was skipped: ${String(outcome.reason?.message ?? outcome.reason).slice(0, 300)}`, skipped: names[index] } });
        return [];
      });
      if (opinions.length === 0) throw new Error(`No reviewer could complete the ${lens} review: ${String((settled[0] as PromiseRejectedResult).reason?.message).slice(0, 500)}`);
      const tag = (runner: string) => (opinions.length > 1 ? `[${runner}] ` : '');
      const findings = opinions.flatMap((o) => o.data.findings.map((f) => ({ ...f, summary: `${tag(o.runner)}${f.summary}` })));
      const summary = opinions.map((o) => `${tag(o.runner)}${o.data.summary}`).join('\n\n');
      const model = opinions.map((o) => o.model).join(' + ');
      // The verdict is derived from severities, so a reviewer cannot block on a nit or wave through a blocker.
      // With several reviewers, one blocker or major finding from any of them is enough to request changes.
      const mustFix = findings.some((f) => f.severity === 'blocker' || f.severity === 'major');
      const result: ReviewResult = { lens, round: state.reviewRound, verdict: mustFix ? 'request-changes' : 'approve', summary, findings, reviewer: { runner: opinions.map((o) => o.runner).join(' + '), model } };
      h.emit({ type: 'review.verdict', node: `review_${lens}`, role: 'reviewer', agent: `reviewer:${lens}`, data: { lens, round: result.round, verdict: result.verdict, findings: result.findings.length, model, reviewers: opinions.length } });
      return { reviews: { [`${state.reviewRound}:${lens}`]: result } };
    });

  const fanOut = (state: State) => lensesFor(state.tier, state.surfaces.graphical, state.regimes.length > 0).map((lens) => `review_${lens}`);

  const renderReviews = (state: State, reviews: ReviewResult[]) =>
    [
      `# AI peer review, round ${state.reviewRound}`,
      '',
      `Run \`${h.runId}\`. Reviewers run in fresh contexts and see only the requirements, the relevant design documents and the diff.`,
      '',
      ...reviews.flatMap((r) => [
        `## ${r.lens} review: ${r.verdict === 'approve' ? 'approved' : 'changes requested'}`,
        '',
        `Reviewer: \`${r.reviewer.model}\` via \`${r.reviewer.runner}\``,
        '',
        r.summary,
        '',
        ...(r.findings.length ? ['| Severity | Location | Finding | Recommendation |', '|---|---|---|---|', ...r.findings.map((f) => `| ${f.severity} | ${f.file ? `\`${f.file}${f.line ? `:${f.line}` : ''}\`` : ''} | ${f.summary} | ${f.recommendation} |`)] : ['No findings.']),
        '',
      ]),
    ].join('\n');

  const reviewGate = work('review_gate', (state) => {
    const reviews = currentReviews(state).sort((a, b) => a.lens.localeCompare(b.lens));
    const markdown = renderReviews(state, reviews);
    const path = h.writeArtifact('review_gate', `docs/reviews/${h.runId}-round-${state.reviewRound}.md`, markdown);
    h.commit('review_gate', `docs(review): round ${state.reviewRound}`);
    if (state.prUrl && h.config.github.postReviews) {
      h.git.push(state.branch);
      h.github.comment(markdown);
    }
    const open = blocking(reviews);
    const exhausted = open.length > 0 && state.reviewRound >= profileFor(state.tier).maxReviewRounds;
    return {
      artifacts: { [`Review round ${state.reviewRound}`]: path },
      ...(exhausted ? { unresolved: [...state.unresolved, `Review findings unresolved after ${state.reviewRound} rounds (${open.map((r) => r.lens).join(', ')})`] } : {}),
    };
  });

  const afterReview = (state: State) => {
    if (blocking(currentReviews(state)).length === 0) return 'gate_release';
    return state.reviewRound >= profileFor(state.tier).maxReviewRounds ? 'gate_release' : 'fix';
  };

  const fix = work('fix', async (state) => {
    const line = (label: string, f: { severity: string; file?: string | undefined; line?: number | undefined; summary: string; recommendation: string }) =>
      `- [${label}/${f.severity}] ${f.file ?? ''}${f.line ? `:${f.line}` : ''} ${f.summary}\n  Fix: ${f.recommendation}`;
    const must = (f: { severity: string }) => f.severity === 'blocker' || f.severity === 'major';
    const fromReview = state.stage === 'review' ? blocking(currentReviews(state)).flatMap((r) => r.findings.filter(must).map((f) => line(r.lens, f))) : [];
    const fromQa =
      state.stage === 'qa' && state.qaResult?.verdict === 'fail'
        ? [...state.qaResult.defects.filter(must).map((d) => line('qa', d)), ...state.qaResult.cases.filter((c) => c.result === 'fail').map((c) => `- [qa/failed check] ${c.requirement}: ${c.check}\n  Evidence: ${c.evidence}`)]
        : [];
    await h.invoke(
      ask(
        state,
        'developer',
        'fix',
        join(
          context(state, ['Product requirements', 'UX specification', 'Architecture']),
          section('QA failures to resolve', fromQa.join('\n')),
          section('Review findings to resolve', fromReview.join('\n')),
          state.licenseViolations.length ? section('Dependencies whose licence is not allowed', `${state.licenseViolations.map((v) => `- ${v}`).join('\n')}\n\nReplace each with the platform's own facilities or a dependency under a permitted licence, and update the dependency table in the architecture.`) : '',
          state.feedback.usability ? section('Observed in usability testing', state.feedback.usability) : '',
          revision(state, 'release'),
          failures(state),
          'Resolve everything above with the smallest correct change, and add or update tests that prove it. Do not commit.',
        ),
        'write',
      ),
    );
    h.commit('fix', state.stage === 'review' ? `fix(review): address round ${state.reviewRound} findings` : `fix(qa): address round ${state.qaRound} findings`);
    return { phase: 'fix', verifyAttempts: state.phase === 'fix' ? state.verifyAttempts + 1 : 1, unresolved: [], checks: null };
  });

  // ----------------------------------------------------------------- release

  const gateRelease = gate('release', (state) => ({
    title: state.unresolved.length ? 'Unresolved problems need your decision' : 'Approve for merge',
    summary: [
      state.unresolved.length ? `Unresolved:\n${state.unresolved.map((u) => `- ${u}`).join('\n')}` : 'All checks pass and every reviewer approved.',
      state.prUrl ? `Pull request: ${state.prUrl}` : `Branch: ${state.branch}`,
      'Approving records your sign-off. The harness never merges; you do.',
    ].join('\n\n'),
    artifacts: Object.values(state.artifacts).slice(-2),
  }));

  const complete = work('complete', (state) => {
    const reviews = Object.values(state.reviews).sort((a, b) => a.round - b.round || a.lens.localeCompare(b.lens));
    const report = [
      `# Run report: ${h.runId}`,
      '',
      `- Request: ${state.request.split('\n')[0]}`,
      `- Tier: ${profileFor(state.tier).label}`,
      `- Surface: ${state.surfaces.graphical ? 'graphical' : 'non-graphical'} (${state.surfaces.platforms.join(', ')})`,
      `- Branch: \`${state.branch}\` from \`${state.baseBranch}\`${state.prUrl ? `\n- Pull request: ${state.prUrl}` : ''}`,
      `- Outcome: ${state.unresolved.length ? `released with ${state.unresolved.length} unresolved item(s) accepted by the approver` : 'all checks and reviews passed'}`,
      '',
      '## Gates',
      '',
      '| Gate | Decision | By |',
      '|---|---|---|',
      ...Object.entries(state.gates).map(([name, g]) => `| ${name} | ${g.decision} | ${g.by} |`),
      '',
      '## Clarifications',
      '',
      ...(state.clarifications.length ? state.clarifications.map((c) => `- ${c.question} **${c.answer}** (${c.source})`) : ['None asked.']),
      '',
      '## Artifacts',
      '',
      ...Object.entries(state.artifacts).map(([name, path]) => `- ${name}: \`${path}\``),
      '',
      '## Decision records',
      '',
      ...state.decisions.map((path) => `- \`${path}\``),
      '',
      '## Reviews',
      '',
      '| Round | Lens | Verdict | Findings | Reviewer model |',
      '|---|---|---|---|---|',
      ...reviews.map((r) => `| ${r.round} | ${r.lens} | ${r.verdict} | ${r.findings.length} | ${r.reviewer.model} |`),
      '',
      '## QA',
      '',
      state.qaResult ? `Round ${state.qaResult.round}: **${state.qaResult.verdict}**. ${state.qaResult.cases.filter((c) => c.result === 'pass').length} passed, ${state.qaResult.cases.filter((c) => c.result === 'fail').length} failed, ${state.qaResult.cases.filter((c) => c.result === 'not-run').length} not run. Tester model: ${state.qaResult.tester.model}.` : 'QA did not run.',
      '',
      '## Audit trail',
      '',
      `The complete event log is \`.foundry/runs/${h.runId}/events.jsonl\`, exported beside this report as \`${h.runId}.events.jsonl\`.`,
      `Chain head when this report was written: \`${h.log.headHash}\`. Verify with \`foundry audit verify ${h.runId}\`.`,
    ].join('\n');
    h.writeArtifact('complete', `docs/runs/${h.runId}.md`, report);
    return {};
  });

  // ------------------------------------------------------------------ wiring

  const graph = new StateGraph(RunState)
    .addNode('intake', intake)
    .addNode('scope', scope)
    .addNode('gate_scope', gateScope)
    .addNode('elicit', elicit)
    .addNode('gate_clarify', gateClarify)
    .addNode('requirements', requirements)
    .addNode('gate_requirements', gateRequirements)
    .addNode('compliance', compliance)
    .addNode('gate_compliance', gateCompliance)
    .addNode('ux', ux)
    .addNode('gate_ux', gateUx)
    .addNode('architecture', architecture)
    .addNode('expert_panel', expertPanel)
    .addNode('gate_architecture', gateArchitecture)
    .addNode('threat_model', threatModel)
    .addNode('gate_threat-model', gateThreat)
    .addNode('plan', plan)
    .addNode('implement', implement)
    .addNode('verify', verify)
    .addNode('fix', fix)
    .addNode('document', document)
    .addNode('qa', qa)
    .addNode('usability_prep', usabilityPrep)
    .addNode('gate_usability', gateUsability)
    .addNode('sbom', sbom)
    .addNode('publish', publish)
    .addNode('review_code', review('code'))
    .addNode('review_security', review('security'))
    .addNode('review_ux', review('ux'))
    .addNode('review_architecture', review('architecture'))
    .addNode('review_compliance', review('compliance'))
    .addNode('review_gate', reviewGate)
    .addNode('gate_release', gateRelease)
    .addNode('complete', complete)
    .addEdge(START, 'intake')
    .addEdge('intake', 'scope')
    .addEdge('scope', 'gate_scope')
    .addConditionalEdges('gate_scope', afterGate('scope', 'elicit', 'scope'), ['elicit', 'scope'])
    .addEdge('elicit', 'gate_clarify')
    .addEdge('gate_clarify', 'requirements')
    .addEdge('requirements', 'gate_requirements')
    .addConditionalEdges(
      'gate_requirements',
      (state) => (state.gates.requirements?.decision === 'revise' ? 'requirements' : 'compliance'),
      ['requirements', 'compliance'],
    )
    .addEdge('compliance', 'gate_compliance')
    .addConditionalEdges(
      'gate_compliance',
      (state) => (state.gates.compliance?.decision === 'revise' ? 'compliance' : state.surfaces.graphical ? 'ux' : 'architecture'),
      ['compliance', 'ux', 'architecture'],
    )
    .addEdge('ux', 'gate_ux')
    .addConditionalEdges('gate_ux', afterGate('ux', 'architecture', 'ux'), ['architecture', 'ux'])
    .addConditionalEdges('architecture', (state) => (state.consults.length > 0 && state.consultRound === 0 ? 'expert_panel' : 'gate_architecture'), ['expert_panel', 'gate_architecture'])
    .addEdge('expert_panel', 'architecture')
    .addConditionalEdges(
      'gate_architecture',
      (state) => (state.gates.architecture?.decision === 'revise' ? 'architecture' : profileFor(state.tier).stages.threatModel ? 'threat_model' : 'plan'),
      ['architecture', 'threat_model', 'plan'],
    )
    .addEdge('threat_model', 'gate_threat-model')
    .addConditionalEdges('gate_threat-model', afterGate('threat-model', 'plan', 'threat_model'), ['plan', 'threat_model'])
    .addEdge('plan', 'implement')
    .addEdge('implement', 'verify')
    .addConditionalEdges('verify', afterVerify, ['implement', 'fix', 'document', 'qa', 'sbom', 'gate_release'])
    .addEdge('document', 'qa')
    .addConditionalEdges('qa', afterQa, ['fix', 'usability_prep', 'sbom'])
    .addEdge('usability_prep', 'gate_usability')
    .addConditionalEdges('gate_usability', afterGate('usability', 'sbom', 'fix'), ['sbom', 'fix'])
    .addConditionalEdges('sbom', afterSbom, ['fix', 'publish'])
    .addConditionalEdges('publish', fanOut, REVIEW_LENSES.map((lens) => `review_${lens}` as const))
    .addEdge('review_code', 'review_gate')
    .addEdge('review_security', 'review_gate')
    .addEdge('review_ux', 'review_gate')
    .addEdge('review_architecture', 'review_gate')
    .addEdge('review_compliance', 'review_gate')
    .addConditionalEdges('review_gate', afterReview, ['fix', 'gate_release'])
    .addEdge('fix', 'verify')
    .addConditionalEdges('gate_release', afterGate('release', 'complete', 'fix'), ['complete', 'fix'])
    .addEdge('complete', END);

  return graph.compile({ checkpointer });
}
