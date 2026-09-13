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
- four role-specific PostgreSQL URLs: `TENANT`, `DISCOVERY`, `PLATFORM`, `WORKER`
- `HZ2_CLAIMS_AUTHORITY_TARGETS_JSON` containing opaque admin target keys and
  Finance V3 `bindingId`, `sourceId`, `formKey`, and `groupReference` values

Apply `config/claims-authority-registry.sql` as a database owner before enabling
the feature. Existing Finance V3 recipient bindings remain an identity-resolution
registry only; they no longer decide whether an observed member may submit.

Production deployment and Render environment changes are intentionally outside
this local installation and require an explicit deployment request.
