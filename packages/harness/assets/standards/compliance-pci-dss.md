### PCI DSS control pack

Applies to this project because payment card data is in scope. The current standard is PCI DSS v4.0.1.

- **Shrink the scope first.** Do not let card numbers touch your systems. Use a PCI-validated payment provider's hosted fields, redirect, or mobile SDK so the cardholder data goes from the customer's device straight to the provider and you store only their token. This is the difference between a short self-assessment and a full audit.
- **Never store sensitive authentication data** (full track data, card verification codes, PINs) after authorisation, in any form, including logs and crash reports.
- If a primary account number must be stored at all: render it unreadable (strong cryptography with managed keys, or truncation), mask it on display, and justify it in a decision record.
- **Segment** anything in scope from everything that is not, and document the boundary.
- **Payment pages:** inventory and authorise every script that runs on them and detect changes to them, as v4 requires.
- **Access:** unique ids, least privilege, multi-factor authentication for all access into the cardholder data environment.
- **Logging and monitoring** of all access to system components in scope, reviewed, retained for at least twelve months.
- **Secure development, vulnerability scanning and penetration testing** on the schedule the standard sets for your level.
- **Know your reporting level:** identify the merchant or service provider level and the self-assessment questionnaire that applies, and keep the evidence it asks for.
- **Right tools:** a PCI-validated payment service provider with tokenisation and hosted fields or its official SDK; never a home-built card form posting to your own server.
