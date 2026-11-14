### Platform guidelines are mandatory

Wherever the owner of a target platform or language publishes best practices or guidelines, they
are requirements, not suggestions.

1. **Identify them.** For every target platform and language in this project, find the current official guidelines. Consult the source itself; do not rely on memory, because they change.
2. **Design to them.** UX specifications and architecture documents name each guideline followed and the specific sections that shaped the design.
3. **Build to them.** Implementation follows the guidelines named in the design documents.
4. **Review against them.** A departure from a named guideline without a decision record is a major finding.
5. **Departures are decisions.** If a guideline should not be followed here, write a decision record saying which one and why.

Known starting points (not exhaustive; look for others that apply):

| Target | Guidelines |
|---|---|
| iOS, iPadOS, macOS, watchOS, visionOS | Apple Human Interface Guidelines (developer.apple.com/design/human-interface-guidelines); App Store Review Guidelines; Swift API Design Guidelines (swift.org/documentation/api-design-guidelines) |
| Android | Android design and quality guidelines (developer.android.com/design, developer.android.com/quality); Material Design 3 (m3.material.io); Kotlin coding conventions |
| Web | WCAG 2.2 (w3.org/TR/WCAG22); WAI-ARIA Authoring Practices; Core Web Vitals guidance (web.dev) |
| Windows | Windows app design guidance (Fluent) |
| Linux desktop | GNOME Human Interface Guidelines or the KDE HIG, matching the toolkit |
| Rust | Rust API Guidelines (rust-lang.github.io/api-guidelines); the Embedded Rust Book for embedded targets |
| TypeScript | The TypeScript handbook's guidance on strictness and declaration design |
| Any hardware, SDK, cloud service or framework used | The vendor's own best-practice and security documentation |
