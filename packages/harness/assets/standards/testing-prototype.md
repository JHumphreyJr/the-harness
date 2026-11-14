### Testing and delivery standard: prototype

A prototype is tested where being wrong would mislead the people evaluating it, and no further.

- **Unit tests: required, light.** Cover the critical functions: the core domain rules, state transitions, parsing, calculations, and anything concurrent or easy to get subtly wrong. Skip glue, views and trivial code. No coverage target.
- **UI and end-to-end tests: not required.** Add one only where the core flow cannot be trusted without it. Verify the interface by running it.
- **Load and performance tests: not required.** Check the performance budget by hand on a real device or browser and note the result in the README.
- **CI/CD: one command.** `scripts/verify.sh` (or the toolchain's standard commands) formats, lints, builds and runs the unit tests. A minimal CI workflow that runs that command on pull requests is welcome but optional. No deployment pipeline.
- The architecture document has a short **Test strategy** section naming the critical functions that will be unit tested.
