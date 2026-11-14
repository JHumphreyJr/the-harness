### Architecture standard: production, small scale

Built for real users at low volume. Operable by one person.

- **Modular monolith.** One deployable service with enforced module boundaries, one managed relational database. Modules communicate through interfaces, never through each other's tables.
- **Stateless service.** No session or file state on the instance, so a second instance or a load balancer can be added later without code changes.
- **Single instance, single region** with automated restarts, health and readiness endpoints, and graceful shutdown.
- **Not included unless a decision record justifies it:** load balancers, auto-scaling, sharding, read replicas, CQRS, message brokers, service meshes, multi-region. In-process background jobs and an in-process cache are the defaults.
- **Resilience at the edges only:** timeouts on every outbound call, retries with exponential backoff and jitter for idempotent operations, application-level rate limiting.
- **Observability sized to the team:** structured logs with request ids, a handful of metrics (request rate, errors, latency, saturation), and an uptime check that pages someone.
- **Delivery:** CI runs format, lint, tests and security scans on every pull request. Deployment is one scripted, repeatable step with a documented rollback. Schema changes are versioned migrations.
- **Recoverable:** automated encrypted backups and a tested restore procedure in the runbook.
- All of the production security standard applies in full.
