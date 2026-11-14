### Compliance standard

Applicability is decided from facts about the product, never assumed and never skipped.

| Regime | It applies when | First question to ask |
|---|---|---|
| GDPR / UK GDPR | Personal data of people in the EU, EEA or UK is processed, wherever the company is | Can any person be identified, directly or indirectly, from what is stored or logged? |
| CCPA / CPRA and other US state privacy laws | Personal information of residents of those states, above the law's business thresholds | Who operates this, and does it meet the thresholds? |
| HIPAA | Protected health information is handled by or for a covered entity or business associate | Is there health data tied to a person, and who is the covered entity? |
| PCI DSS | Payment card account data is stored, processed or transmitted, or the system can affect the security of that data | Does a card number ever touch our systems, even in transit? |
| COPPA and children's codes | The product is directed at children or knowingly collects data from them | Could a child be a user? |
| EU Cyber Resilience Act | A product with digital elements is made available on the EU market | Is this distributed to anyone in the EU as a product? |
| EU AI Act | The product is or contains an AI system placed on the EU market | Does it make or support decisions about people using a model? |
| SOC 2, ISO 27001, customer contracts | A customer or sales process requires it | Has anyone been promised this? |

Rules:

1. **Data inventory first.** No applicability decision without a list of data categories, their source, where they are stored, who can read them, and how long they are kept.
2. **Minimise before you protect.** Collect less, keep it for less time, and keep it out of logs, analytics and backups it does not need to be in.
3. **Obligations become requirements.** Each applicable obligation is written as a testable requirement with an owner, traced through architecture, tasks, QA and review like any functional requirement.
4. **Evidence is kept.** The assessment, the decisions and the checks live in `docs/compliance/` and travel with the code.
5. **Scope changes reopen the assessment.** Adding accounts, payments, health data, a new market or a new data processor requires reassessment before design continues.
6. **A person confirms.** At production tiers a named human approves the assessment. An agent's assessment is a working position, not legal advice.

### Software bill of materials and open source licences (every project, every tier)

- An SBOM is generated from the final build in CycloneDX 1.6 or later, JSON, and committed at `sbom/bom.cdx.json`. It follows the published EU baseline (BSI TR-03183-2): creator and timestamp, and for each component a name, version, licence and SHA-512 hash, with dependency relationships. Vulnerability information is kept out of the SBOM, in separate VEX or CSAF documents.
- One SBOM per released version. Regenerate it whenever dependencies change.
- Licences of shipped components are checked against the project's policy. Strong and network copyleft licences are not allowed in shipped code without a decision record. Unknown or custom licences need a person to review them.
- `THIRD-PARTY-NOTICES.md` is generated from the SBOM and shipped with the product, with the licence texts it refers to.
- The project's own licence, and the licence of every vendored file, is stated.
