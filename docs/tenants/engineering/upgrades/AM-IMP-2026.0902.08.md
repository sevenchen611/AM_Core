# Engineering installation — AM-IMP-2026.0902.08

Status: Deployed

The Engineering AM runtime now contains the Party A profile master, private
signing-asset upload path, contract-version snapshot integration, and final PDF
rendering support. Local dry-runs cover company and individual validation,
private Drive/hash verification, schema v6, and PDF output.

Production deployment evidence:

- PR #104 merged as `2a9769f` and Render deployment
  `dep-dabvqk3bc2fs73eusgr0` reached Live.
- PostgreSQL schema v6 was applied transactionally. The profile table is owned
  by the Engineering contract owner, forced RLS is active, the runtime role has
  SELECT/INSERT/UPDATE but no DELETE, and the company constraint requires only
  `large_seal`.
- The authenticated `甲方主檔` page showed `公司（大章）` and
  `公司大章（必填）` with no small-seal control.
- Temporary migration CONNECT and SET ROLE access were revoked and verified.
- No real profile, signing image, contract version, PDF, signature, or LINE
  message was created during deployment verification.

Real company and personal records still need their complete authoritative
legal fields and signing assets before they can be imported. A controlled
version-snapshot and final signed-PDF verification should be performed after
those records are available; the real values must remain outside AMCore.
