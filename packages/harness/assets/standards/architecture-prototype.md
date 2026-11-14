### Architecture standard: prototype

- **One deployable unit.** A single binary, or one server plus its client. One process, one data store (a file or SQLite is fine), one command to run.
- **No infrastructure.** No containers required, no queues, caches, gateways, or service split. No authentication or multi-tenancy.
- **Still structured.** Separate domain logic from I/O and UI so the prototype can be promoted instead of rewritten. Storage sits behind an interface.
- **Still tested and linted.** Critical functions have unit tests, as the prototype testing standard describes; the project has a formatter and linter configured from the first commit.
- **Honest about limits.** The README lists what is missing for production.
