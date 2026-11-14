import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * The audit trail. One JSON object per line, append-only, hash-chained:
 * every record carries the hash of the previous record, so editing or deleting
 * any line breaks verification of everything after it.
 *
 * This file is the single source of truth for a run. The CLI, the run report,
 * and the 3D viewer all read it; nothing else is authoritative.
 */

export type EventType =
  | 'run.started'
  | 'run.completed'
  | 'run.failed'
  | 'node.entered'
  | 'node.exited'
  | 'node.skipped'
  | 'agent.started'
  | 'agent.message'
  | 'agent.tool'
  | 'agent.finished'
  | 'artifact.written'
  | 'decision.recorded'
  | 'gate.requested'
  | 'gate.resolved'
  | 'verify.result'
  | 'review.verdict'
  | 'qa.verdict'
  | 'sbom.result'
  | 'dispatch.planned'
  | 'policy.denied'
  | 'git.commit'
  | 'pr.opened';

export interface EventInput {
  type: EventType;
  node?: string;
  role?: string;
  /** Distinguishes parallel agents that share a role (the review lenses). */
  agent?: string;
  data?: Record<string, unknown>;
}

export interface AuditEvent extends EventInput {
  seq: number;
  ts: string;
  runId: string;
  prev: string;
  hash: string;
}

export const GENESIS = '0'.repeat(64);

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{30,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:api[_-]?key|token|secret|password)\b\s*[:=]\s*["']?[^\s"']{8,}/gi,
];

/** Best-effort secret scrubbing so the audit log does not become a credential store. */
export function redact<T>(value: T): T {
  if (typeof value === 'string') {
    let out: string = value;
    for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[REDACTED]');
    return out as T;
  }
  if (Array.isArray(value)) return value.map((item) => redact(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v)])) as T;
  }
  return value;
}

/** Deterministic JSON: object keys sorted, so the hash does not depend on insertion order. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

export function hashEvent(event: Omit<AuditEvent, 'hash'>): string {
  return createHash('sha256').update(canonical(event)).digest('hex');
}

export type Listener = (event: AuditEvent) => void;

export class EventLog {
  private seq = 0;
  private head = GENESIS;
  private listeners = new Set<Listener>();

  constructor(
    readonly file: string,
    readonly runId: string,
  ) {
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file)) {
      // Resuming a run: continue the existing chain instead of starting a second one.
      const events = readEvents(file);
      const last = events.at(-1);
      if (last) {
        this.seq = last.seq;
        this.head = last.hash;
      }
    }
  }

  emit(input: EventInput): AuditEvent {
    const body: Omit<AuditEvent, 'hash'> = {
      seq: ++this.seq,
      ts: new Date().toISOString(),
      runId: this.runId,
      type: input.type,
      ...(input.node ? { node: input.node } : {}),
      ...(input.role ? { role: input.role } : {}),
      ...(input.agent ? { agent: input.agent } : {}),
      data: redact(input.data ?? {}),
      prev: this.head,
    };
    const event: AuditEvent = { ...body, hash: hashEvent(body) };
    // Synchronous append: an event is durable before the action it describes continues.
    appendFileSync(this.file, `${JSON.stringify(event)}\n`);
    this.head = event.hash;
    for (const listener of this.listeners) listener(event);
    return event;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get headHash(): string {
    return this.head;
  }
}

export function readEvents(file: string): AuditEvent[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as AuditEvent);
}

export interface VerifyReport {
  ok: boolean;
  count: number;
  head: string;
  /** Sequence number of the first record that fails, when not ok. */
  brokenAt?: number;
  reason?: string;
}

export function verifyChain(events: AuditEvent[]): VerifyReport {
  let prev = GENESIS;
  let expectedSeq = 1;
  for (const event of events) {
    const { hash, ...body } = event;
    if (event.seq !== expectedSeq) {
      return { ok: false, count: events.length, head: prev, brokenAt: event.seq, reason: `expected seq ${expectedSeq}` };
    }
    if (event.prev !== prev) {
      return { ok: false, count: events.length, head: prev, brokenAt: event.seq, reason: 'prev hash does not match' };
    }
    if (hashEvent(body) !== hash) {
      return { ok: false, count: events.length, head: prev, brokenAt: event.seq, reason: 'record content was altered' };
    }
    prev = hash;
    expectedSeq += 1;
  }
  return { ok: true, count: events.length, head: prev };
}
