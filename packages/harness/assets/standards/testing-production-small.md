### Testing and delivery standard: production, small scale

- **Unit tests: required** for all domain logic, including failure paths. Tests are deterministic and fast.
- **Integration tests: required** at every boundary: database, external services (against fakes or containers), and the API contract between clients and server.
- **UI and end-to-end tests: required for each critical user flow**, driven through accessibility identifiers and roles. Include an automated accessibility check.
- **Security tests:** authorisation negative cases for every resource, input validation, and dependency and secret scanning.
- **Load and performance tests: light.** One scripted test at the expected peak (state the number) that checks the performance budget, run before release. No soak or capacity programme.
- **CI: required on every pull request.** Format, lint, build, unit and integration tests, security scans. The default branch is protected by these checks.
- **CD: one scripted, repeatable deployment** with versioned migrations and a documented, tested rollback. Manual promotion is fine.
- The architecture document has a **Test strategy** section: what is tested at each level, the critical flows, the peak load figure, and how CI and deployment work.
