### TypeScript standard (web)

- `strict: true` plus `noUncheckedIndexedAccess`. No `any`; use `unknown` and narrow. No non-null assertions without a comment proving safety.
- ESLint and a formatter run in CI with zero warnings.
- Validate all external data (network, storage, environment) at the boundary with a schema, and derive types from the schema.
- Model state with discriminated unions; handle every case exhaustively.
- **Vanilla first.** Build on the web platform: semantic HTML, modern CSS (custom properties, grid, container queries), Web Components and the standard APIs. No UI framework, state library, CSS framework or utility belt unless the architecture's dependency table justifies it.
- **Performance budget in CI:** the initial JavaScript and CSS payload and the Core Web Vitals targets from the architecture are checked, not hoped for.
- On the server, prefer the runtime's built-in HTTP, crypto, test runner and SQLite or the database's official driver before reaching for a framework.
- ES modules. Pure domain logic has no imports from the framework, the DOM or the network.
- Server: every handler authenticates, authorises, validates input, and returns typed errors. No string-built SQL or HTML.
- Client: semantic HTML first; components are keyboard accessible; loading, empty and error states are implemented, not left for later. Ship only the JavaScript a view needs.
- Tests with the runtime's built-in test runner where it suffices: unit tests for logic always; component tests through accessible roles and end-to-end tests as the testing standard for the project's tier requires.
