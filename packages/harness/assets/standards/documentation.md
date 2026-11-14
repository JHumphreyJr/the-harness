### Documentation standard

- `README.md`: what this is, how to install, run, test and configure it. Must work when followed literally on a clean machine.
- `docs/product/PRD.md`, `docs/ux/UX-SPEC.md`, `docs/architecture/ARCHITECTURE.md`, `docs/security/THREAT-MODEL.md`: kept current when the design changes.
- `docs/decisions/`: one record per significant decision. Records are never edited after acceptance; a changed decision gets a new record that supersedes the old one.
- Production tiers add `docs/operations/RUNBOOK.md`: deploy, roll back, back up, restore, and what each alert means.
- Public interfaces have doc comments (rustdoc, TSDoc).
