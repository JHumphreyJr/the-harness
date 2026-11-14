### Technology selection

The goal is always performance. Every choice of language, framework and library is judged by
what it costs the person using the product, not by what it saves the person writing it.

**Order of preference**

1. **The platform itself.** The language's standard library and the platform's own frameworks (on iOS: SwiftUI, UIKit, Foundation, SwiftData, URLSession; in the browser: the DOM, Web Components, Fetch, CSS; in Rust: `std` and `core`). Vanilla is the default.
2. **A small, focused, mature library** that does one thing the platform does not.
3. **A framework**, only when the product needs what it provides and nothing above does.

**A dependency is acceptable only if all of these hold**

- **Mature:** stable releases, a track record in production, active maintenance, and a credible future.
- **Security tested:** a published security policy or advisory history, timely fixes, and no unresolved critical advisories. Prefer libraries that have been independently audited or are maintained by the platform vendor.
- **Documented:** complete official documentation and, where it has a user interface or API surface, its own published guidelines (which then become mandatory under the platform guidelines standard).
- **Lean:** its runtime cost (binary or bundle size, startup time, memory, an extra runtime or bridge) is known and justified. State the number.
- **Necessary:** the architect can say in one sentence what the platform could not do.

**Not acceptable**

- A framework or language chosen because it makes development easier or faster, when the platform's native tools do the job. Never React Native, Flutter or a web view where native iOS or Android frameworks suffice.
- Abstraction layers, meta-frameworks, or runtimes that sit between the code and the platform without a measured benefit to the user.
- Utility libraries that replace a few lines of straightforward code.
- Anything new, unproven, unmaintained, or without security history.

**What the architect must produce**

- A **dependency table**: every third-party dependency, what it is for, what the platform could not do, and its runtime cost. An empty table is the best outcome.
- A **performance budget** with numbers appropriate to the product: for example launch time, time to first interaction, frame rate, memory ceiling, binary or bundle size, and response time for the critical operations.
- A decision record for any framework, and for any dependency that is large or unusual.

**What reviewers check**

- A dependency in the code that is not in the architecture's dependency table is a major finding.
- A change that would break the performance budget, or that adds weight without need, is a major finding.
