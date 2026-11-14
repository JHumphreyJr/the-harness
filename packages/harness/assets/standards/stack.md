### Stack policy

- **Native desktop and embedded** software is written in **Rust**.
- **Web** software (browser clients and their servers) is written in **TypeScript**.
- **Mobile** apps are always written in the platform's native language with its native UI toolkit: **Swift and SwiftUI on iOS**, **Kotlin and Jetpack Compose on Android**. No cross-platform frameworks and no web views standing in for native UI.
- A product spanning several of these uses each where it applies, joined by a typed, versioned contract (for example an OpenAPI or JSON Schema definition from which each side generates its types).
- Choosing anything else requires a decision record stating what the default could not do.
- **Web is vanilla first:** TypeScript against the web platform itself (DOM, Web Components, Fetch, CSS). A UI framework, meta-framework or CSS framework needs a decision record showing what the platform could not do and what it costs in bundle size and startup time.
- Within each language, the platform's own frameworks come first. See the technology selection standard: performance is the goal, and convenience for the developer is never a reason to add weight.
