# 0002. Put agents behind a runner interface

- Status: Accepted
- Date: 2026-11-14

## Context

The harness should not be tied to one model vendor, and independent review is stronger when the
reviewer is a different model from the author. But the best coding agents are vendor products
with their own tools and sandboxes.

## Options considered

### Claude Agent SDK only
- Good: least glue, richest tooling and hooks.
- Bad: Claude models only.

### One generic tool-calling loop for every model
- Good: uniform.
- Bad: reimplements file editing, shell and sandboxing, badly, for every vendor.

### A runner interface with three kinds
- Good: each role uses the engine that suits it; vendors can be mixed per role.
- Bad: audit detail differs by runner.

## Decision

An `AgentRunner` interface with `claude-agent-sdk`, `cli`, `chat`, and `mock` implementations.
Authoring and review roles need no workspace access: the harness inlines their context and writes
their output, so any chat model can fill them. The developer role requires a workspace runner.

## Consequences

Structured output uses a portable convention (a final fenced JSON block validated with zod)
instead of vendor-specific features. Tool-level auditing and policy enforcement exist only for
the Claude runner; CLI runners must be sandboxed by the operator.
