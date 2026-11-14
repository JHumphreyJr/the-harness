# 0008. Technology is chosen for performance: platform first, vanilla by default

- Status: Accepted (decided by the owner)
- Date: 2026-11-14

## Context

Left alone, coding agents reach for whatever framework is most common in their training data,
which optimises for developer convenience. The owner's rule is the opposite: the goal is always
performance, using mature, security-tested, documented frameworks, without bloat added to make
development easier. The canonical example: do not use React Native when native iOS frameworks do
the job.

## Options considered

### Leave technology choice to the architect's judgement
- Good: flexible.
- Bad: drifts toward popular, heavy stacks; nothing for a reviewer to check against.

### A fixed allow-list of frameworks
- Good: predictable.
- Bad: goes stale, and cannot cover every platform the harness will meet.

### A selection standard with required evidence
- Good: applies to any platform; produces artifacts a reviewer can check.
- Bad: depends on the architect researching honestly, so it needs enforcement.

## Decision

A technology selection standard (`assets/standards/technology.md`): the platform itself first,
then a small mature library, then a framework only when needed. Every dependency must be mature,
security tested, documented, lean and necessary. Web defaults to vanilla TypeScript on the web
platform.

Enforcement:

1. The architect must return a performance budget (the run fails without one) and a dependency
   table with what the platform could not do, the runtime cost, and the maturity evidence.
2. The harness writes both into `ARCHITECTURE.md`.
3. Code and architecture reviewers treat an unlisted dependency or a threat to the budget as a
   major finding.

## Consequences

More code is written by hand against platform APIs. Designs take longer because the architect
must check documentation, maintenance and advisories. A project that needs a framework can still
have one, with a decision record.
