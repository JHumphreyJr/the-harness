### Testing and delivery standard: production, at scale

Everything in the small-scale standard, plus:

- **Contract tests** between every pair of services, run in CI on both sides.
- **UI and end-to-end tests for all critical flows on every supported platform**, with visual or snapshot checks where layout matters.
- **Load testing: required and repeatable.** Tests at expected peak, at a stated multiple of peak, a soak test, and a spike test, each checked against the performance budget and service level objectives. Results are kept and compared between releases.
- **Resilience testing:** fault injection for each dependency to prove circuit breakers, retries, bulkheads and fallbacks behave as designed.
- **Performance regression checks in CI** for the hot paths.
- **CI/CD: fully automated.** Infrastructure as code, progressive delivery (canary or blue-green) with automated rollback on service level indicators, and no manual steps on the path to production.
- The architecture document has a **Test strategy** section covering all of the above, with the load model and the environments each kind of test runs in.
