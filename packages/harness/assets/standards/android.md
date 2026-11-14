### Android standard (Kotlin and Jetpack Compose)

- **Android's design and quality guidelines and Material Design 3 govern the design.** Use standard navigation, components, system back behaviour and edge-to-edge layout.
- **Kotlin** with coroutines and Flow; follow the Kotlin coding conventions. **Jetpack Compose** for UI.
- **Structure:** follow the official guide to app architecture: UI layer with state holders, an optional domain layer, a data layer behind repositories. Unidirectional data flow. Domain logic lives in a plain Kotlin module testable without a device.
- **Jetpack and the platform first.** A third-party library needs an entry in the architecture's dependency table saying what the platform and Jetpack could not do.
- **Performance is measured:** startup time, jank and memory are checked with Macrobenchmark and baseline profiles against the architecture's budget.
- **Accessibility:** content descriptions, 48 by 48 dp targets, font scaling to 200 percent, TalkBack through the core flow, sufficient contrast.
- **Adaptivity:** light and dark themes, dynamic colour where appropriate, window size classes for larger screens, configuration changes without state loss.
- **Platform behaviour:** survive process death with state restored; request runtime permissions in context; respect background execution limits.
- **Security:** secrets in the Keystore, encrypted storage for sensitive data, cleartext traffic disabled.
- **Quality gates:** lint and detekt or ktlint clean; unit tests for the domain module. How much is tested, and whether UI tests are required, follows the testing standard for the project's tier.
- **`scripts/verify.sh`** at the repository root builds and tests every target and exits non-zero on any failure.
