# 0004. The viewer attaches to the log, not to the process

- Status: Accepted
- Date: 2026-11-14

## Context

A 3D view of agents working must be attachable and detachable at will and must never affect a
run. Existing tools (Vibecraft, Realm, Termi, Tide Commander, Claude Office) visualise the raw
tool calls of a coding session; none shows a workflow graph with gates and tiers.

## Options considered

### Adopt an existing visualiser
- Good: no 3D code to maintain.
- Bad: they show one session's tool calls, not stages, gates, decisions or review loops.

### Embed a WebSocket server in the running harness
- Good: lowest latency.
- Bad: couples the run to the viewer; finished runs cannot be replayed.

### A separate bridge that tails the event log
- Good: zero coupling, replay for free, works on exported logs.
- Bad: about 200 ms behind real time.

## Decision

A small custom viewer (three.js) fed by a bridge that tails `events.jsonl` and serves it over a
localhost WebSocket. The board layout comes from the topology published in the `run.started`
event, so the viewer has no knowledge of the workflow baked in.

## Consequences

The viewer is read-only. Answering gates from the viewer would need a write path back to the
harness and is deliberately left out of this version.
