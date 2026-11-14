# 0009. Checkpoint to a JSON file instead of SQLite

- Status: Accepted
- Date: 2026-11-14

## Context

Run state was checkpointed with `@langchain/langgraph-checkpoint-sqlite`. On first install that
brought in `better-sqlite3` (a native addon with an install script) and through it the
deprecated `prebuild-install`. That breaks the harness's own technology standard (0008): a
native dependency and an unmaintained transitive package, for a few kilobytes of state with one
writer.

## Options considered

### Keep the SQLite checkpointer
- Good: maintained by the LangGraph team.
- Bad: native addon, install script, deprecated transitive dependency.

### Node's built-in `node:sqlite`
- Good: no dependency.
- Bad: still marked experimental on Node 22, and needs a hand-written checkpointer.

### Persist LangGraph's in-memory checkpointer to a file
- Good: about 80 lines, no dependency, atomic writes, state sits beside the run's audit log.
- Bad: rewrites the whole file each step; unsuitable for many concurrent threads, which a run does not have.

## Decision

`FileCheckpointSaver` extends LangGraph's `MemorySaver` and writes
`.foundry/runs/<runId>/checkpoint.json` after every step.

## Consequences

Installing the harness compiles nothing and runs no dependency install scripts. Resume is covered
by a test that kills a run at a gate and restarts it from disk. It relies on `MemorySaver`'s
public `storage` and `writes` fields, so a LangGraph upgrade should re-run that test.
