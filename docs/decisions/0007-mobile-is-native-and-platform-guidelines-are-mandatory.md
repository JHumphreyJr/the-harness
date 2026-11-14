# 0007. Mobile is always native, and platform guidelines are mandatory

- Status: Accepted (decided by the owner)
- Date: 2026-11-14
- Supersedes: 0006

## Context

The harness needed a rule for mobile apps. Separately, the owner requires that whenever a target
platform publishes best practices or guidelines, such as Apple's Human Interface Guidelines, they
are used.

## Options considered

### Cross-platform framework (React Native, Flutter, Tauri mobile)
- Good: one codebase, shared code with the web.
- Bad: not the platform's language or toolkit; platform conventions are approximated.

### Native language and toolkit per platform
- Good: full platform fidelity and the platform's own guidelines apply directly.
- Bad: one codebase per platform; sharing with the web happens through a contract, not code.

## Decision

1. Mobile apps are always written in the platform's native language and UI toolkit: Swift and
   SwiftUI on iOS, Kotlin and Jetpack Compose on Android. `ios` and `android` are separate
   platforms, each with its own standard.
2. Official platform and language guidelines are mandatory. This is enforced in three places:
   the UX designer and architect must return the guidelines they designed to as structured
   output, and a run fails if they name none; the harness writes them into the design documents;
   and reviewers treat an unrecorded departure as a major finding.
3. Agents on the Claude runner get read-only web search and fetch so they consult the current
   guidelines instead of recalling them.

## Consequences

A product for iOS and Android is two apps. Web and mobile share a typed, versioned contract
instead of code. Projects with more than one toolchain provide `scripts/verify.sh` as their
verification gate. Web access means agents read untrusted pages; it is limited to reading, and
the tool-call policy still applies to everything they do afterwards.
