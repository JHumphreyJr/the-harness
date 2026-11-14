### iOS standard (Swift and SwiftUI)

- **Apple's Human Interface Guidelines govern the design.** Use standard navigation patterns, system components, SF Symbols, system colours and materials, and platform gestures before inventing anything. Read the relevant HIG pages for each pattern used.
- **Swift 6 language mode** with strict concurrency checking. Follow the Swift API Design Guidelines for naming.
- **SwiftUI first**, with the Observation framework for state. UIKit only where SwiftUI cannot do the job, behind a representable.
- **Structure:** a local Swift package holds domain logic, models and networking so it builds and tests with `swift test` without a simulator; the app target is a thin shell of views and composition. Views contain no business rules.
- **The Xcode project is reproducible from text** checked into the repository. Never hand-edit generated project files.
- **Accessibility is not optional:** Dynamic Type at every size including accessibility sizes, VoiceOver labels, traits and sensible focus order, minimum 44 by 44 point targets, Reduce Motion and Increase Contrast honoured, no meaning carried by colour alone.
- **Adaptivity:** light and dark appearance, safe areas, all supported iPhone sizes, and orientation where it makes sense.
- **Platform behaviour:** handle interruption, backgrounding and relaunch with state restored; say what works offline; ask for each permission in context with a clear purpose string, and only when needed.
- **Security:** secrets and tokens in the Keychain, never in UserDefaults or the bundle. App Transport Security stays on. Include a privacy manifest when required.
- **Apple's frameworks first.** SwiftUI, Foundation, SwiftData or Core Data, URLSession, Swift concurrency, CloudKit, MultipeerConnectivity, ActivityKit and the rest of the SDK are the default answer. A third-party package needs an entry in the architecture's dependency table saying what the SDK could not do. Through Swift Package Manager only.
- **Performance is measured:** launch time, scrolling at the display's full frame rate, memory, and energy use are checked with Instruments and XCTest performance tests against the architecture's budget.
- **Quality gates:** zero compiler warnings; a formatter and linter configured; unit tests for the package with Swift Testing or XCTest. How much is tested, and whether XCUITest UI tests are required, follows the testing standard for the project's tier (a prototype needs light unit tests of critical logic and no UI tests).
- **`scripts/verify.sh`** at the repository root builds and tests every target in the project (for the app: `xcodebuild test` against a simulator destination) and exits non-zero on any failure. The harness runs this script as the project's verification gate.
