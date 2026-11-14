### HIPAA control pack

Applies to this project because it handles protected health information (PHI).

- **Business associate agreements** in place with every vendor that can touch PHI, before any PHI reaches them. Use only services the vendor designates as HIPAA-eligible, configured as their guidance requires.
- **Minimum necessary:** each role and service sees only the PHI it needs. No PHI in logs, analytics, error reports, URLs, push notifications or email.
- **Access control:** unique user identification, role-based access, automatic logoff, emergency access procedure.
- **Audit controls:** every read, write and export of PHI is logged with who, what, when and from where; logs are tamper-evident and retained for six years.
- **Integrity and transmission security:** encryption in transit and at rest with managed keys; integrity checks on stored records.
- **Person or entity authentication** with multi-factor authentication for anyone who can reach PHI.
- **Contingency:** encrypted backups, a tested restore, and a documented recovery plan.
- **Breach notification** process meeting the Breach Notification Rule's deadlines.
- **De-identification** by the Safe Harbor or Expert Determination method wherever identified data is not required, especially in test and analytics environments. Never use real PHI in development or test.
- **Right tools:** HIPAA-eligible cloud services under a BAA, a managed key service, an identity provider with enforced MFA, and centralised immutable audit logging.
