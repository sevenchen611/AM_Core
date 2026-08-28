# AM-IMP-2026.0828.01 — Engineering contract management

Tenant: `engineering`  
Runtime target: `AM_PLATFORM`  
Status: Ready

## Prepared and verified

As of 2026-08-28, the shared runtime implementation and graphical Engineering
AM contract workspace are deployed behind a disabled signing gate. Preparation
completed without committing production identifiers, credentials, contract
records, customer information, or signing tokens:

- A separate logical Engineering contract database and owner/runtime roles were
  provisioned on the existing PostgreSQL instance.
- Schema version `2026-08-28.engineering-contract-evidence.v1` was applied and
  its eleven tables were observed.
- The runtime role can use required mutable workflow operations and append
  immutable evidence, but cannot own or alter the schema, truncate evidence,
  disable triggers, or update/delete immutable signing records.
- The runtime database connection passed `verify-full` TLS checks, including
  rejection of an untrusted CA and hostname mismatch.
- Existing Notion contract properties and rows were preserved while the
  package's additive electronic-signing projection fields were added.
- The production PDF renderer rejected a missing idempotency key and generated
  a PDF whose response SHA-256 matched the downloaded bytes.
- Package, contract dry-run, core, and Engineering convergence checks passed
  during implementation.

## Remaining activation checks

Signing remains disabled. The following checks still require production-local
evidence before this target can move beyond `Ready`:

1. Verify private Engineering Drive folder access with a disposable upload,
   download/hash comparison, and removal, without changing existing sharing.
2. Create and verify the Engineering LIFF endpoint and configure its LIFF ID.
3. Verify the exact trusted proxy hop and overwritten client-IP header on a
   deployed request.
4. Verify backup recovery and complete a disposable restore/hash drill.
5. Run one controlled non-production contract through the active project LINE
   group with exactly one designated signer, including wrong-member and revoked
   token denial checks.
6. Reconcile PostgreSQL, PDF, receipt, Drive hashes, Notion projection, and
   budget projection, then obtain project-owner acceptance.

Only after those gates pass may signing be enabled and the record advance to
`Installed`. `Deployed` additionally requires project-owner verification of the
controlled production signing flow and its evidence package.

## Rollback posture

While signing is disabled, rollback is limited to keeping the contract routes
unavailable for issuance, stopping outbox workers, and retaining PostgreSQL and
Drive evidence. Never delete immutable evidence or overwrite an issued version.
Follow the package `ROLLBACK.md` for any later pilot rollback.
