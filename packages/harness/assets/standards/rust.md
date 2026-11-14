### Rust standard (native and embedded)

- Stable toolchain pinned in `rust-toolchain.toml`. Edition 2024.
- `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` pass. `#![forbid(unsafe_code)]` unless a decision record permits `unsafe`; every `unsafe` block states its safety invariant.
- Errors: `thiserror` for library error types, `anyhow` at binary boundaries only. No `unwrap` or `expect` outside tests, except where a comment proves it cannot fail.
- Model state with types. Make invalid states unrepresentable with enums and newtypes instead of validating at runtime.
- Keep `main` thin. Logic lives in a library crate so it can be tested without the runtime.
- Async only where there is real concurrent I/O. Do not hold locks across `.await`.
- **Embedded:** `#![no_std]` where the target requires it; no heap allocation in interrupt context; hardware behind `embedded-hal` traits so logic is tested on the host; panics have a defined handler; stack and memory budgets are stated.
- **Native UI:** UI code depends on the core crate, never the reverse.
- Dependencies are few and deliberate: prefer `std`, then small, widely used, audited crates. Check `cargo audit` and consider `cargo vet` or `cargo deny`. Keep compile features minimal.
- Performance is measured: benchmarks for hot paths, release builds profiled before optimising, and no allocation in loops that do not need it.
- Tests: unit tests beside the code, integration tests in `tests/`, property tests for parsers and state machines.
