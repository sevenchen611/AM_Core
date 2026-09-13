# AM-IMP-2026.0912.01 — Finance V3 自助授權後台

Status: `Installed` (local branch; not deployed)

This project-local installation adds the fixed-key claims authority registry,
LINE group/member observation, the protected `/admin/claims-authority` console,
and the authority-backed Finance V3 group-entry adapter.

The identity key is intentionally fixed (`fixed-v1`). Rotation is not supported
or required by this installation. Back up the configured secret; losing it makes
stored LINE identities undecryptable and the runtime fails closed.

## Required deployment configuration

- `HZ2_CLAIMS_AUTHORITY_ENABLED=true`
- `HZ2_CLAIMS_AUTHORITY_MODE=enforce`
- `HZ2_CLAIMS_AUTHORITY_IDENTITY_KEY` (one fixed secret, at least 32 bytes)
- `HZ2_CLAIMS_AUTHORITY_CSRF_TOKEN` (at least 32 bytes)
- Existing `HZ2_FINANCE_CLAIMS_V3_DATABASE_URL` is reused by default; optional
  role-specific URLs may be supplied later for stricter credential separation.
- Existing Finance V3 scopes are converted into safe back-office targets. The
  optional `HZ2_CLAIMS_AUTHORITY_TARGETS_JSON` can override their labels/keys.

The enabled service applies `config/claims-authority-registry.sql` idempotently
during startup. Existing recipient bindings remain compatible identity aliases;
new observed members receive a deterministic opaque identity automatically and
do not require an allowlist entry.

Production deployment and Render environment changes are intentionally outside
this local installation and require an explicit deployment request.
