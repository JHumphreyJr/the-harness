/**
 * The viewer's model of a run, derived purely from audit events. Applying the same events
 * always yields the same world, which is what makes replay and scrubbing exact.
 */

export interface Ev {
  seq: number;
  ts: string;
  runId: string;
  type: string;
  node?: string;
  role?: string;
  agent?: string;
  data?: Record<string, any>;
}

export interface TopoNode {
  id: string;
  label: string;
  kind: 'work' | 'gate' | 'check';
  role?: string;
  phase: Phase;
  x: number;
  z: number;
}
export type Phase = 'discover' | 'design' | 'build' | 'review' | 'release';
export interface Topology {
  nodes: TopoNode[];
  edges: { from: string; to: string; kind: 'flow' | 'loop' }[];
}

export type NodeStatus = 'idle' | 'active' | 'done' | 'waiting' | 'skipped' | 'failed';

export interface NodeState {
  status: NodeStatus;
  visits: number;
  note: string;
  artifacts: string[];
}

export interface AgentState {
  id: string;
  role: string;
  lens: string | null;
  /** Distinguishes parallel agents of one role: a build track, or a reviewer's runner. */
  tag: string | null;
  node: string | null;
  working: boolean;
  activity: string;
  model: string;
  order: number;
}

export interface FeedItem {
  seq: number;
  time: string;
  tone: 'plain' | 'good' | 'warn' | 'bad' | 'you';
  who: string;
  text: string;
  node?: string;
}

export interface World {
  run: {
    id: string;
    request: string;
    tier: string | null;
    status: 'none' | 'running' | 'waiting' | 'completed' | 'failed';
    prUrl: string | null;
    surface: string;
  };
  topology: Topology;
  nodes: Map<string, NodeState>;
  agents: Map<string, AgentState>;
  feed: FeedItem[];
  decisions: { id: string; title: string; decision: string; path: string; node: string }[];
  waiting: { node: string; title: string; summary: string } | null;
  lastExited: string[];
}

/** A one-off visual the scene should play. Not part of world state. */
export type Effect = { kind: 'travel'; from: string; to: string } | { kind: 'pulse'; node: string; tone: 'good' | 'warn' | 'bad' };

export const TIER_LABEL: Record<string, string> = {
  prototype: 'Prototype',
  'production-small': 'Production, small scale',
  'production-scale': 'Production, at scale',
};

export const ROLE_LABEL: Record<string, string> = {
  analyst: 'Analyst',
  product: 'Product',
  compliance: 'Compliance',
  expert: 'Expert',
  ux: 'UX designer',
  architect: 'Architect',
  security: 'Security',
  planner: 'Planner',
  developer: 'Developer',
  qa: 'QA',
  reviewer: 'Reviewer',
  writer: 'Writer',
};

export const lensName = (lens: string) => (lens === 'ux' ? 'UX' : `${lens[0]?.toUpperCase()}${lens.slice(1)}`);

export function agentName(agent: Pick<AgentState, 'role' | 'lens' | 'tag'>): string {
  // An expert is known by its domain, not by the generic role.
  if (agent.role === 'expert' && agent.tag) return `${agent.tag.replace(/-/g, ' ')} expert`.replace(/^./, (c) => c.toUpperCase());
  const base = agent.lens ? `${lensName(agent.lens)} reviewer` : (ROLE_LABEL[agent.role] ?? agent.role);
  return agent.tag ? `${base} (${agent.tag})` : base;
}

export function emptyWorld(): World {
  return {
    run: { id: '', request: '', tier: null, status: 'none', prUrl: null, surface: '' },
    topology: { nodes: [], edges: [] },
    nodes: new Map(),
    agents: new Map(),
    feed: [],
    decisions: [],
    waiting: null,
    lastExited: [],
  };
}

const short = (text: unknown, max = 140) => {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

export function applyEvent(world: World, ev: Ev): Effect[] {
  const effects: Effect[] = [];
  const d = ev.data ?? {};
  const node = ev.node ? world.nodes.get(ev.node) : undefined;
  const label = (id?: string) => world.topology.nodes.find((n) => n.id === id)?.label ?? id ?? '';
  const say = (tone: FeedItem['tone'], who: string, text: string) =>
    world.feed.push({ seq: ev.seq, time: ev.ts.slice(11, 19), tone, who, text, ...(ev.node ? { node: ev.node } : {}) });

  const agent = () => {
    const id = ev.agent ?? ev.role;
    if (!id) return undefined;
    let a = world.agents.get(id);
    if (!a) {
      // Agent ids look like role, role:lens, role@tag or role:lens@tag.
      const [head, tag] = id.split('@');
      const [role, lens] = (head ?? id).split(':');
      a = { id, role: role ?? id, lens: lens ?? null, tag: tag ?? null, node: null, working: false, activity: '', model: '', order: world.agents.size };
      world.agents.set(id, a);
    }
    return a;
  };

  switch (ev.type) {
    case 'run.started': {
      world.run = { id: ev.runId, request: d.request ?? '', tier: d.tier ?? null, status: 'running', prUrl: null, surface: '' };
      world.topology = d.topology ?? { nodes: [], edges: [] };
      for (const n of world.topology.nodes) world.nodes.set(n.id, { status: 'idle', visits: 0, note: '', artifacts: [] });
      say('plain', 'Harness', `Run started: ${short(d.request, 200)}`);
      break;
    }
    case 'node.entered': {
      if (!node || !ev.node) break;
      node.status = 'active';
      node.visits += 1;
      node.note = node.visits > 1 ? `Pass ${node.visits}` : '';
      // Animate the work arriving from whichever upstream stage most recently finished.
      const from = [...world.lastExited].reverse().find((id) => world.topology.edges.some((e) => e.from === id && e.to === ev.node));
      if (from) effects.push({ kind: 'travel', from, to: ev.node });
      say('plain', 'Harness', `${label(ev.node)} started${node.visits > 1 ? ` (pass ${node.visits})` : ''}`);
      break;
    }
    case 'node.exited': {
      if (!node || !ev.node) break;
      node.status = d.ok === false ? 'failed' : 'done';
      world.lastExited.push(ev.node);
      if (world.lastExited.length > 12) world.lastExited.shift();
      for (const a of world.agents.values()) if (a.node === ev.node) Object.assign(a, { node: null, working: false, activity: '' });
      if (d.ok === false) say('bad', 'Harness', `${label(ev.node)} failed: ${short(d.error)}`);
      break;
    }
    case 'agent.started': {
      const a = agent();
      if (!a) break;
      Object.assign(a, { node: ev.node ?? null, working: true, activity: 'Thinking', model: d.model ?? '' });
      say('plain', agentName(a), `Started at ${label(ev.node)} on ${d.model}`);
      break;
    }
    case 'agent.tool': {
      const a = agent();
      if (!a) break;
      a.activity = short(`${d.tool} ${d.detail ?? ''}`, 60);
      say('plain', agentName(a), short(`${d.tool} ${d.detail ?? ''}`));
      break;
    }
    case 'agent.message': {
      const a = ev.role ? agent() : undefined;
      if (d.text) say('plain', a ? agentName(a) : 'Harness', short(d.text, 220));
      break;
    }
    case 'agent.finished': {
      const a = agent();
      if (!a) break;
      a.working = false;
      a.activity = d.ok === false ? 'Reply rejected, retrying' : 'Done';
      if (d.ok === false) say('warn', agentName(a), `Reply rejected: ${short(d.error)}`);
      break;
    }
    case 'artifact.written':
      if (node) node.artifacts.push(d.path);
      say('good', 'Harness', `Wrote ${d.path}`);
      break;
    case 'decision.recorded':
      world.decisions.push({ id: d.id, title: d.title, decision: d.decision, path: d.path, node: ev.node ?? '' });
      if (d.tier) {
        world.run.tier = d.tier;
        world.run.surface = `${d.graphical ? 'Graphical' : 'Non-graphical'}, ${(d.platforms ?? []).join(' + ')}`;
      }
      say('good', 'Decision', `${d.id}: ${d.title}`);
      break;
    case 'gate.requested':
      if (node) node.status = 'waiting';
      world.run.status = 'waiting';
      world.waiting = { node: ev.node ?? '', title: d.title ?? 'Approval needed', summary: d.summary ?? '' };
      effects.push({ kind: 'pulse', node: ev.node ?? '', tone: 'warn' });
      say('you', 'Waiting on you', d.title ?? '');
      break;
    case 'gate.resolved': {
      const revise = d.decision === 'revise';
      if (node) {
        node.status = revise ? 'idle' : 'done';
        node.visits += d.by === 'policy' ? 1 : 0;
        node.note = d.by === 'policy' ? 'Auto' : revise ? 'Sent back' : `Approved by ${d.by}`;
      }
      if (ev.node) world.lastExited.push(ev.node);
      world.waiting = null;
      if (world.run.status === 'waiting') world.run.status = 'running';
      if (d.answers?.tier) world.run.tier = d.answers.tier;
      effects.push({ kind: 'pulse', node: ev.node ?? '', tone: revise ? 'warn' : 'good' });
      if (d.by === 'policy') say('plain', 'Gate', `${label(ev.node)} auto-approved: ${d.reason}`);
      else say(revise ? 'warn' : 'good', 'Gate', `${label(ev.node)}: ${revise ? `sent back by ${d.by}. ${short(d.feedback)}` : `approved by ${d.by}`}`);
      break;
    }
    case 'verify.result':
      if (node) node.note = d.ok ? 'Checks pass' : 'Checks failing';
      effects.push({ kind: 'pulse', node: ev.node ?? '', tone: d.ok ? 'good' : 'bad' });
      say(d.ok ? 'good' : 'bad', 'Verification', d.ok ? `All ${d.steps?.length ?? 0} checks pass` : `Failed: ${short(d.steps?.at(-1)?.command)}`);
      break;
    case 'review.verdict': {
      const ok = d.verdict === 'approve';
      if (node) node.note = ok ? 'Approved' : `${d.findings} finding${d.findings === 1 ? '' : 's'}`;
      effects.push({ kind: 'pulse', node: ev.node ?? '', tone: ok ? 'good' : 'warn' });
      say(ok ? 'good' : 'warn', `${lensName(String(d.lens))} review`, ok ? `Approved in round ${d.round}` : `Changes requested in round ${d.round} (${d.findings} findings)`);
      break;
    }
    case 'dispatch.planned': {
      const list = (d.assignments ?? []) as { task: string; track: string; runner: string; size: string; risk: string }[];
      if (node) node.note = list.length > 1 ? `${list.length} agents in parallel` : `${d.remaining} task${d.remaining === 1 ? '' : 's'} left`;
      say('plain', 'Dispatcher', `${list.length > 1 ? `${list.length} tasks in parallel` : 'One task'}: ${list.map((a) => `${a.task} on ${a.track} (${a.size}, ${a.risk} risk) to ${a.runner}`).join('; ')}${d.note ? `. ${d.note}` : ''}`);
      break;
    }
    case 'qa.verdict': {
      const ok = d.verdict === 'pass';
      if (node) node.note = ok ? `Passed (${d.passed} checks)` : `${d.failed} failed, ${d.defects} defects`;
      effects.push({ kind: 'pulse', node: ev.node ?? '', tone: ok ? 'good' : 'warn' });
      say(ok ? 'good' : 'warn', 'QA', `Round ${d.round}: ${ok ? 'passed' : 'failed'}. ${d.passed} passed, ${d.failed} failed, ${d.notRun} not run, ${d.defects} defects`);
      break;
    }
    case 'sbom.result': {
      const clean = d.generated && !d.denied && !(d.checksFailed ?? []).length;
      if (node) node.note = d.generated ? `${d.components} components` : 'Not generated';
      effects.push({ kind: 'pulse', node: ev.node ?? '', tone: clean ? 'good' : d.generated ? 'warn' : 'bad' });
      say(clean ? 'good' : d.generated ? 'warn' : 'bad', 'SBOM', d.generated ? `${d.format}, ${d.components} components. ${d.denied} forbidden licence(s), ${d.needsReview + d.unlicensed} to review, ${(d.checksFailed ?? []).length} EU baseline check(s) failed` : `Not generated: ${short(d.error, 160)}`);
      break;
    }
    case 'policy.denied':
      say('bad', 'Policy', `Blocked ${d.tool} ${short(d.detail, 60)}: ${d.reason}`);
      break;
    case 'git.commit':
      say('plain', 'Git', `${d.sha} ${short(d.message, 90)}`);
      break;
    case 'pr.opened':
      world.run.prUrl = d.url ?? null;
      say('good', 'Pull request', d.url ?? 'opened');
      break;
    case 'run.completed':
      world.run.status = 'completed';
      world.run.prUrl = d.prUrl ?? world.run.prUrl;
      for (const n of world.nodes.values()) if (n.visits === 0 && n.status === 'idle') n.status = 'skipped';
      for (const a of world.agents.values()) Object.assign(a, { node: null, working: false, activity: '' });
      say('good', 'Harness', d.unresolved?.length ? `Run finished with ${d.unresolved.length} unresolved item(s)` : 'Run finished. Every check and review passed.');
      break;
    case 'run.failed':
      world.run.status = 'failed';
      say('bad', 'Harness', `Run failed: ${short(d.error, 240)}`);
      break;
  }
  return effects;
}
