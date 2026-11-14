# 0001. Orchestrate with LangGraph

- Status: Accepted
- Date: 2026-11-14

## Context

The harness needs explicit stages, human approval gates, loops (verify, review), parallel
reviewers, and the ability to resume a run. The workflow must be auditable, which rules out
letting a model decide the next step.

## Options considered

### LangGraph.js
- Good: explicit state machine, checkpointing, interrupts for human gates, parallel fan-out, 1.x and widely used.
- Bad: more concepts than a hand-written loop; a dependency on the LangChain ecosystem.

### Claude Code plugin only (subagents, skills, hooks)
- Good: simplest to install; nothing to run.
- Bad: routing is prompt-driven, so gates and loops are suggestions, not guarantees.

### Rust-native graph engines (GraphBit, weavegraph, regula)
- Good: fast, single binary.
- Bad: pre-1.0 or thinly adopted. The harness waits on model calls, so runtime speed buys nothing.

### CrewAI and other role-chat frameworks
- Good: quick to prototype.
- Bad: weaker durable state and deterministic control flow.

## Decision

LangGraph.js, with the workflow defined in `packages/harness/src/graph.ts`.

## Consequences

The harness is TypeScript. Rust remains the default for the native and embedded software the
harness produces. Node names cannot collide with state keys, and code before an `interrupt` runs
again on resume, so gate nodes have no side effects before they interrupt.
