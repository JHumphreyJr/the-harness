# 0013. A compliance layer decides what applies; every project gets an SBOM

- Status: Accepted (requested by the owner)
- Date: 2026-11-14

## Context

Production work needs compliance expertise. Two requirements: every project must produce an SBOM
that meets EU expectations and satisfies open source licence obligations; and the pipeline must
recognise when a regime such as GDPR, HIPAA or PCI DSS applies and bring in the right controls
and tools, without burdening projects it does not apply to.

## Options considered

### Always apply every control pack
- Good: nothing is missed.
- Bad: buries small projects in irrelevant obligations, which teaches people to ignore them.

### Leave compliance to the security reviewer
- Good: no new stage.
- Bad: applicability is a question about the product and its data, decided before design, not a property of a diff.

### An assessment stage that switches packs on, plus a deterministic SBOM stage
- Good: obligations exist only where they apply and are traced like requirements; the SBOM is produced and checked by code, not by a model's reading.
- Bad: the assessment is an AI working position and must be confirmed by a person.

## Decision

1. **Compliance assessment** after requirements, at every tier. A compliance analyst inventories
   the data and decides, per regime, applies, does not apply or uncertain, with reasons and with
   what would change the answer. At production tiers a person confirms it at a gate, and an
   uncertain regime is treated as applicable until they rule it out.
2. **Control packs** (`assets/standards/compliance-*.md`) are added to the architect, security,
   planner, developer, QA and reviewer prompts only for applicable regimes. Each names the
   established tool for the job.
3. **A compliance review lens** runs on the pull request at production tiers when a regime applies.
4. **SBOM stage** before every pull request, at every tier. OWASP cdxgen generates CycloneDX 1.6
   JSON. The harness checks it against the BSI TR-03183-2 v2.1.0 baseline used for the EU Cyber
   Resilience Act, applies the licence policy to shipped components, and generates
   `THIRD-PARTY-NOTICES.md`. A forbidden licence gets one round of rework, then escalates. At
   production tiers, baseline gaps and licences needing review block release until a person decides.

## Consequences

The CRA itself names no format; TR-03183-2 is the most concrete published baseline and it can
change, so the checks live in one file (`src/sbom.ts`). The checks are a subset, not a
certification. Vulnerability information is deliberately kept out of the SBOM, as the baseline
requires; continuous vulnerability monitoring against the SBOM is not yet part of the pipeline.
