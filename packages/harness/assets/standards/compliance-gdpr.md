### GDPR and UK GDPR control pack

Applies to this project. Build these in; reviewers and QA check them.

- **Lawful basis and purpose** recorded for each category of personal data. No processing beyond the stated purpose.
- **Data minimisation and storage limitation:** collect only what a requirement needs; every category has a retention period and an automated deletion path, including backups and logs.
- **Privacy by design and by default (Article 25):** the most private setting is the default; pseudonymise where identity is not needed.
- **Data subject rights are features:** access and portability (export in a machine-readable format), rectification, erasure, restriction and objection, each completable within one month, with identity verification.
- **Consent,** where it is the basis, is specific, opt-in, recorded with time and version, and as easy to withdraw as to give. No pre-ticked boxes, no bundling.
- **Records of processing** kept current. A **data protection impact assessment** is done before high-risk processing (large-scale special-category data, systematic monitoring, profiling with significant effects).
- **Processors and transfers:** every third party that receives personal data has a data processing agreement; transfers outside the EEA or UK have a valid mechanism. Each one is listed.
- **Security of processing (Article 32):** encryption in transit and at rest, access control with least privilege, access logging without logging the personal data itself.
- **Breach readiness:** detection, an internal escalation path, and the ability to notify the supervisory authority within 72 hours of becoming aware.
- **Right tools:** a secrets manager and managed key service for encryption keys; an established identity provider instead of home-built authentication; a consent management approach that records proof; automated personal-data scanning of logs and repositories.
