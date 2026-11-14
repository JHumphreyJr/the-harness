# 0014. The architect can consult domain experts on a draft

- Status: Accepted (requested by the owner)
- Date: 2026-11-14

## Context

One architect agent makes decisions across databases, caching, messaging and transport. A
generalist is most likely to be wrong exactly where a specialist would see the failure mode. The
owner asked for experts that are included as needed, for the architect to bounce decisions off.

## Options considered

### A fixed panel that reviews every design
- Good: nothing is missed.
- Bad: most designs do not use most technologies; cost with no benefit.

### Free conversation between the architect and experts
- Good: closest to how people work.
- Bad: unbounded, hard to audit, and tends to converge on agreement.

### One bounded round: draft, parallel expert critique, revision
- Good: bounded cost, each expert works independently in a fresh context, and the exchange is a document.
- Bad: a single round; an expert cannot answer a follow-up.

## Decision

The architect's first pass may return `consults`: an expert, a topic and exact questions, up to
the tier's limit (2, 4 or 6). If it does, the design is saved as a draft and no decisions are
recorded yet. The experts then review the draft in parallel, each with its own brief from
`assets/experts/` (or a generic brief for a domain with no file), and return a verdict, findings
and the official sources they checked. Their output is written to
`docs/architecture/EXPERT-REVIEW.md`. The architect revises once, adopting each finding or keeping
its decision with a stated reason, and only then are decision records written.

Experts on file: relational databases, document and key-value stores, caching, messaging (MQTT,
AMQP, Kafka), HTTP APIs, RPC and wire formats (gRPC, Protocol Buffers), real-time delivery.

## Consequences

Adding an expert is adding a markdown file. Experts advise; the architect decides and the human
gate approves. A failed consultation is recorded and does not stop the run.
