### UX standard

Applies to anything a person looks at or interacts with, at every tier.

- **Start from the user's job.** Every screen exists to help someone finish something. If you cannot name it, remove the screen.
- **One primary action per view**, visually dominant. Destructive actions are separated, confirmed, and undoable where possible.
- **Design every state**: empty (with guidance on what to do next), loading (skeletons for content, spinners only for short waits), partial, error (what happened, what to do), offline, and success.
- **Respond within 100 ms** to input. Anything longer than a second shows progress; anything longer than ten can be cancelled.
- **Accessibility is WCAG 2.2 AA at minimum**: text contrast 4.5:1, interactive targets at least 24 by 24 CSS pixels (44 on touch), full keyboard operation with visible focus, semantic structure and labels, no information carried by colour alone, and `prefers-reduced-motion` honoured.
- **Consistency through tokens.** Colour, type, spacing and motion come from a defined token set, not ad hoc values.
- **Words are interface.** Plain language, sentence case, specific button labels ("Save entry", not "OK"). Error messages say what to do next.
- **Responsive by default** from 320 px upward; layouts reflow, they do not shrink.
- **Forgive mistakes.** Validate inline, preserve input on error, never lose a user's work.
- **Embedded and device displays** follow the same principles within their limits: legible at viewing distance, state always visible, no dead ends.
