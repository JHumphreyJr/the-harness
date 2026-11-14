# 0012. QA is its own stage, and usability is a human gate

- Status: Accepted (requested by the owner)
- Date: 2026-11-14

## Context

Automated tests ran in the verification step after each build wave, but nothing independent
checked the finished build against the requirements, and nothing asked whether people could
actually use it. Code review answers "is this change sound", which is a different question.

## Decision

**QA stage** (automated, after documentation, before a pull request exists). A QA agent that did
not write the code tests the build against the PRD and returns one case per requirement with
evidence. The harness:

- adds any functional requirement the tester did not mention as "not run", so gaps are visible;
- derives the verdict itself: a failed case or a blocker or major defect fails QA, and at the
  production tiers so does any untested functional requirement;
- writes a traceability report to `docs/qa/` and loops failures back to the developer, then
  through verification and QA again, up to the tier's limit.

**Usability gate** (human, after QA passes, only when the product has an interface). The UX agent
writes a test plan a person can run with real participants. The gate then waits for that person:
approve, or revise with what was observed, which sends the work back through rework,
verification and QA. Proceeding without testing is allowed but must be stated, and is recorded
as that person's decision.

The gate applies at every tier, including prototype: finding out whether the idea works for
people is what a prototype is for.

## Options considered

- **Simulated usability testing by an agent.** Rejected as a gate: a model predicting what users
  would do is a heuristic review, which the UX reviewer already performs. It is not evidence.
- **Folding QA into code review.** Rejected: reviewers read a diff; QA runs the product.

## Consequences

Every graphical run now stops once for a person before the pull request. Remove `usability` from
a tier's gates in `src/tiers.ts` to change that. QA can only exercise what the machine can run
and must say what it could not.
