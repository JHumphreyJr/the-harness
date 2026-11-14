### Security standard: baseline (prototype tier)

Authentication, tenancy and isolation are out of scope at this tier. These are not:

- No secrets, tokens or personal data in the repository, logs, or example files.
- Validate and bound all external input. Use parameterised queries. Never build shell commands or HTML from input by concatenation.
- Network services bind to localhost unless the requirement says otherwise.
- Dependencies are pinned by lockfile, and the ecosystem audit (`cargo audit`, `npm audit`) shows no known critical issues.
- No `unsafe` Rust without a comment stating the invariant that makes it sound.
- The README states plainly that this is a prototype and what must change before real users or real data touch it.
