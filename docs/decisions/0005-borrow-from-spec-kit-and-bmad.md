# 0005. Borrow from Spec Kit and BMAD instead of installing them

- Status: Accepted
- Date: 2026-11-14

## Context

GitHub Spec Kit (specify, plan, tasks, implement) and the BMAD method (a simulated team of
analyst, PM, architect, developer and QA agents) are the established approaches to spec-driven
development with AI.

## Options considered

### Install Spec Kit or BMAD and wrap it
- Good: maintained by others, familiar to many.
- Bad: both are prompt and slash-command driven inside one coding agent; gates, tier pruning and audit events would have to be bolted on from outside.

### Take their proven ideas into the graph
- Good: the staged artifacts and role separation become enforced nodes and gates.
- Bad: we maintain our own prompts.

## Decision

Adopt the ideas: a requirements document before a plan before tasks (Spec Kit), written by
separate specialised roles (BMAD), with standing project standards (Spec Kit's constitution).
Implement them as graph nodes with typed outputs.

## Consequences

Role prompts and standards live in `packages/harness/assets` as plain markdown and can be
overridden per project. For AI review in CI the harness does reuse an existing tool unchanged:
Anthropic's `claude-code-action`.
