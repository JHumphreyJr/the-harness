### Security standard: production (both production tiers)

Defense in depth. Every layer assumes the one in front of it has failed.

**Identity and access**
- Authenticate users through OAuth 2.0 / OIDC with an established provider. No home-grown password storage.
- Authorise every request on the server, per object. Broken object-level authorisation is the most common serious defect; test the negative case for every resource.
- Least privilege for every user, service and credential.
- Sessions are short-lived, rotated, and revocable.

**Data**
- TLS 1.3 for all traffic, internal included. Encryption at rest (AES-256) for databases, object storage and backups.
- Classify data. Collect the minimum. Personal data has a retention and deletion path.
- Backups are automated, encrypted, and restoring from them has been tested.

**Secrets**
- No secrets in code, images or config files. Load them from a secrets manager or the platform's secret store, and rotate them.

**Application (OWASP Top 10)**
- Parameterised queries only. Context-aware output encoding. Strict input validation at every trust boundary.
- CSRF protection on state-changing requests. A restrictive Content-Security-Policy. Secure, HttpOnly, SameSite cookies.
- Rate limiting and lockout on authentication and expensive endpoints.
- Server-side request forgery controls on anything that fetches a URL.
- Errors reveal nothing about internals.

**Supply chain**
- Lockfiles committed. Dependency and secret scanning in CI. Builds are reproducible from a clean checkout.

**Detection**
- Security-relevant events (sign-in, authorisation failure, privilege change, data export) are logged with who, what and when, without logging secrets or personal data.

**At the scale tier, additionally**
- Zero trust between services: every call authenticated, authorised and encrypted with mutual TLS.
- A web application firewall and volumetric DDoS protection at the perimeter.
- Automatic secret rotation, and per-service identities.
