# 0003. Make a hash-chained JSONL file the single source of truth

- Status: Accepted
- Date: 2026-11-14

## Context

Decision logs and audit trails are a primary requirement. The trail must be complete, hard to
alter unnoticed, readable without special tools, and able to travel with a pull request.

## Options considered

### Append-only JSONL with a SHA-256 chain
- Good: one file, greppable, diffable, verifiable offline, no service to run.
- Bad: tamper-evident, not tamper-proof; someone who can rewrite the whole file can rebuild the chain.

### OpenTelemetry traces to a collector
- Good: standard, good tooling.
- Bad: needs infrastructure; traces are not designed as evidence and do not live in the repository.

### A database
- Good: queryable.
- Bad: another moving part; does not travel with the code.

## Decision

Every action emits an event to `.foundry/runs/<id>/events.jsonl`. Each event includes the hash of
the previous one. The finished log is exported to `docs/runs/` and committed.

## Consequences

The CLI output, the run report and the viewer are all projections of this file. Anchoring the
head hash somewhere external (a signed tag, a transparency log) would make it tamper-proof and is
left for later. An OpenTelemetry exporter can be added as a subscriber without changing anything.
