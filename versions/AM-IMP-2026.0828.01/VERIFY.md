# Verify — AM-IMP-2026.0828.01

## Package and syntax checks

```text
node -e "for (const f of ['upgrade.json','config/engineering-contract-workflow.json','config/environment-contract.json','contracts/engineering-contract-api.json','notion-schemas/engineering-contract-projection.json']) JSON.parse(require('fs').readFileSync('versions/AM-IMP-2026.0828.01/'+f,'utf8')); console.log('JSON OK')"
node tools/check-upgrade-package.js AM-IMP-2026.0828.01
Get-ChildItem tools/dryrun-engineering-contract-*.mjs | Sort-Object Name | ForEach-Object { node $_.FullName; if ($LASTEXITCODE -ne 0) { throw "Contract dry-run failed: $($_.Name)" } }
```

With an empty disposable PostgreSQL database:

```text
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f versions/AM-IMP-2026.0828.01/schemas/engineering-contract-evidence.sql
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT version FROM engineering_contracts.schema_meta WHERE singleton = true;"
```

Do not point schema verification at production without an approved migration
window and backup checkpoint.

## Schema invariants

Verify with disposable rows:

1. `tenant_key` accepts only `engineering`.
2. Version status accepts only `draft`, `internal_review`, `approved`, `frozen`,
   `issued`, `superseded`, and `voided`. Freeze is an atomic
   `approved → frozen` compare-and-set.
3. A frozen version requires a validated snapshot, non-empty canonical JSON
   manifest array, bundle hash, freeze actor, and freeze time. After freeze,
   changing the version content, documents, payment terms, or acceptance
   criteria fails.
4. Issue accepts only `frozen → issued` and may add only the issued PDF Drive
   ID/hash and issue actor/time. Signing-session insert rejects every version
   status except `issued`.
5. A signing session expires exactly seven days after issue.
6. Only one non-terminal designated-signer session exists for a version.
7. A signature insert fails unless the session is `opened` or `signed` and
   unexpired, the
   verified user ID matches, all three identity booleans are true, and the bundle
   hash matches the issued version.
8. Updating or deleting signing events, signatures, and artifacts fails.
9. Consecutive signing events have increasing sequence numbers and a matching
   `previous_event_hash` (the first is `NULL`); duplicate idempotency keys are
   rejected. Runtime event columns are exactly `session_id`, `actor_kind`,
   `actor_id`, and `payload`.
10. No raw signing token column exists.
11. `external_session_id` accepts opaque `cs_...` IDs and is unique;
    compare-and-swap updates `status`, `state_snapshot`, and increments
    `row_version` by exactly one without permitting session deletion.
12. Session states accept `issued`, `sent`, `opened`, `signed`, `confirmed`,
    `completed`, `declined`, `expired`, and `revoked`. The signing-service event
    types listed in the machine workflow all insert successfully with actor kinds
    `admin`, `signer`, `system`, and `provider`.
13. `signed` does not require final artifacts. `confirmed` requires immutable
    signature and submission evidence; `completed` fails until both signed-PDF
    and evidence-receipt artifact rows exist.

## Authorization tests

1. A user with view permission can read only contracts in their project scope.
2. Direct contract, version, document, Drive file, budget item, and group IDs
   from another project return 404/403 and produce no write.
3. Manage permission cannot issue; issue permission cannot void; ordinary issue
   permission cannot perform admin repair.
4. Every internal mutation records the Portal `access.actor`; a browser-supplied
   `operator`, tenant, project, group, signer, status, or IP is ignored or rejected.
5. A manual Notion change to `已簽署` is corrected by projection and creates no
   PostgreSQL signing event.

## Signer and token tests

1. The invitation contains at least 32 random bytes encoded as an opaque token;
   PostgreSQL contains only its HMAC digest.
2. Valid token + valid LIFF identity + exact expected user ID + current group
   membership succeeds.
3. Wrong LIFF user, copied link, inactive binding, wrong project, removed group
   member, expired token, revoked token, malformed token, and hash mismatch all
   fail closed with no signature or signed artifact.
4. A token is valid for no more than `604800` seconds using database time.
5. Resend does not extend expiry. Reissue revokes the old session and records a
   new session/event trail.
6. Retrying the same submit/callback idempotency key returns the prior result and
   creates no second signature, artifact, budget write, or LINE message.
7. In Render proxy mode, an internal socket peer plus `CF-Connecting-IP` records
   that header; a public socket peer ignores it, and missing/malformed
   `CF-Connecting-IP` never falls back to attacker-supplied `X-Forwarded-For`.

## File and evidence tests

1. Hash every raw file before issue and re-read it from Drive to verify the hash.
2. Modify one byte of a fixture and confirm issue/sign validation fails.
3. The signed PDF visibly includes signature, IP, issued time, LINE send-accepted
   time, authenticated received time, signed time, contract/version IDs, and
   bundle hash.
4. The evidence receipt includes UTC and `Asia/Taipei` representations, trusted
   proxy decision, LIFF verification result, membership verification result,
   designated-user match, artifact hashes, and event-chain head.
5. A normal contract list masks IP; only authorized evidence views expose it.
6. Neither Drive nor Notion contains a raw signing token or token pepper.

## Failure and recovery tests

1. LINE send failure leaves the version issued, records the failure, and permits
   idempotent retry; it must not claim `sent`.
2. Notion outage retains a pending outbox item while PostgreSQL evidence remains
   authoritative.
3. Drive failure before issue blocks issue. Failure after signature submission
   retains `signed` evidence but blocks `completed` until the signed PDF and
   receipt are durably stored and hashed.
4. Restart between each workflow step resumes from PostgreSQL/outbox without a
   duplicate message, signature, or artifact.
5. Restore a disposable backup and recompute every bundle, artifact, signature,
   and event-chain hash.

## Production gate

- The pilot is signed in the LINE in-app browser by the designated member.
- A second member cannot sign the same group-visible link.
- The final Drive files are private and recoverable.
- PostgreSQL, PDF, receipt, Notion projection, and budget projection agree.
- The project owner accepts the timestamp labels and receives a downloadable
  evidence package.
- No secret, production ID, external contract data, or customer record was
  committed to AMCore.

After target installation, also run the applicable AM Platform authorization,
engineering, and alignment checks. Existing unrelated baseline failures must be
recorded separately; they must not be represented as a contract-signing pass.
