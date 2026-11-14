# 0010. Testing and delivery scale with the tier

- Status: Accepted (decided by the owner)
- Date: 2026-11-14

## Context

Testing was covered only in passing: "tests are part of the change" in the clean-code standard,
a UI test demanded on mobile at every tier, CI mentioned for production only, and load testing
named only at the scale tier. The owner's rule: unit, UI and load testing and CI/CD must be
considered deliberately; a prototype does not need load or UI testing in all cases, but light
unit tests of critical functions matter even there.

## Decision

One testing and delivery standard per tier (`assets/standards/testing-*.md`):

| | Prototype | Production, small scale | Production, at scale |
|---|---|---|---|
| Unit tests | Light, critical functions only | All domain logic | All domain logic |
| Integration and contract | No | Boundaries and the client-server contract | Plus contract tests between services |
| UI and end-to-end | Not required | Each critical flow | All critical flows, every platform |
| Load and performance | Not required; budget checked by hand | One test at expected peak | Peak, multiple of peak, soak, spike, kept per release |
| Resilience | No | No | Fault injection |
| CI | One verify command; workflow optional | Required on every pull request | Required, with performance regression checks |
| CD | None | Scripted deploy with tested rollback | Fully automated, progressive, auto-rollback |

The architect writes a test strategy section, the planner turns it into tasks (and adds none the
tier does not call for), the developer follows it, and the code reviewer checks against it.

## Consequences

Platform standards no longer set test levels themselves; they defer to the tier. Over-testing a
prototype is now a review finding in the same way under-testing a production system is.
