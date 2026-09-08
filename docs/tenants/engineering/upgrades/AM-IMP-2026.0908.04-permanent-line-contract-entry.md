# AM-IMP-2026.0908.04 — Permanent LINE contract entry and final PDF

- Status: Ready
- Target: AM Platform Engineering tenant
- Database migration: none
- Environment change: none
- Production verification: pending deployment

The original opaque LINE invitation becomes the durable contract entry. A
current member of the exact bound LINE group can keep using it after signing;
once archiving is complete, the page is read-only and serves the private,
relationship-checked and SHA-256-verified final signed PDF. Revoked links and
expired incomplete sessions remain blocked.
