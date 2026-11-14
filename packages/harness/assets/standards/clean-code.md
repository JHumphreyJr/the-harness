### Clean code standard

Applies at every tier, including prototypes.

- **Names say what things are.** No abbreviations a newcomer would have to ask about.
- **Functions do one thing** at one level of abstraction. If a function needs a comment to explain its sections, it is several functions.
- **Modules hide decisions.** Dependencies point inward toward domain logic; domain code does not import frameworks, databases or transport.
- **Errors are values or typed failures**, handled where something useful can be done. Never swallowed, never used for control flow.
- **No dead code, no commented-out code, no speculative generality.** Build what the task needs.
- **Comments explain why**, never what. Public interfaces carry doc comments.
- **Tests are part of the change, sized to the tier.** Prototype: light unit tests for the critical functions only; UI, end-to-end and load tests are not required. Production, small scale: unit and integration tests, UI tests for critical flows, one load test at expected peak, CI on every pull request and a scripted deployment. Production, at scale: all of that plus contract, resilience and repeatable load testing and fully automated delivery. Tests are deterministic and assert behaviour, not implementation.
- **Formatting and linting are automated** and pass with zero warnings.
- **Configuration comes from the environment**, never from literals in code. No secrets in the repository, ever.
- **Small, coherent commits** that each leave the build passing.
