# 0011. A dispatcher builds independent tracks in parallel

- Status: Accepted (requested by the owner)
- Date: 2026-11-14

## Context

Tasks were built one at a time by one model. Multi-tier products (database, API, web client,
mobile apps) have tiers that can be built independently once the contract between them is
fixed, and different tasks suit different models.

## Options considered

### Let a model decide parallelism and model choice at run time
- Good: adapts to anything.
- Bad: not repeatable, not explainable, and it spends tokens deciding how to spend tokens.

### LangGraph fan-out with one graph node per task
- Good: native to the framework.
- Bad: the task list is only known at run time, and parallel nodes would share one working tree.

### A deterministic dispatcher inside the build node, with git worktrees
- Good: same plan and config always give the same schedule; isolation is real; conflicts are detected by git, not guessed.
- Bad: each worktree needs its own dependency install; merges can conflict.

## Decision

1. The planner gives every task a `track`, real `dependsOn`, a `size` and a `risk`, and is told
   to define the cross-tier contract first so the tiers can proceed independently.
2. The dispatcher (`src/dispatch.ts`) computes the next wave: tasks whose dependencies are done,
   at most one per track, capped by `dispatch.maxParallel`.
3. It routes each task to a runner: `dispatch.byTrack`, then `dispatch.bySize` (high risk counts
   as large), then the developer default.
4. Each agent in a wave of more than one works in its own worktree and branch. Branches are
   merged in plan order. A task that conflicts is discarded and redone alone on the merged tree.
5. Checks run once per wave on the merged result. A failure is repaired by one developer.
6. An agent building a single-platform track receives only that platform's standards.
7. Every wave emits a `dispatch.planned` event with each assignment and its reason.

## Consequences

Track ownership of directories is a planning rule, enforced after the fact by merge conflicts
rather than up front. Parallel waves multiply plan usage per minute, so `maxParallel` defaults to
3. Review, QA and rework remain single-stream or lens-parallel.
