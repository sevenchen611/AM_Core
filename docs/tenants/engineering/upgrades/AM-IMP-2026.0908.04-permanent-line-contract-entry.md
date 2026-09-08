# AM-IMP-2026.0908.04 — Permanent LINE contract entry and final PDF

- Status: Deployed
- Target: AM Platform Engineering tenant
- Database migration: none
- Environment change: none
- Production verification: PR #135, commit `b593221`, Render deploy
  `dep-dafuhtm7bikc73emeg6g`

The original opaque LINE invitation becomes the durable contract entry. A
current member of the exact bound LINE group can keep using it after signing;
once archiving is complete, the page is read-only and serves the private,
relationship-checked and SHA-256-verified final signed PDF. Revoked links and
expired incomplete sessions remain blocked.

Production verification confirmed the exact commit is Live, `/health` returned
HTTP 200, and the original completed-contract LINE invitation opened without a
used-token error. The page identified the completed archive, automatically
rendered all 18 pages of the final signed PDF, and exposed no Party A or Party B
signing panel. No contract, signing event, LINE message or artifact was mutated.
