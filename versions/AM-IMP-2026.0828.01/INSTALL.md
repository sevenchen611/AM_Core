# Install — AM-IMP-2026.0828.01

Keep `ENG_CONTRACTS_SIGNING_ENABLED=0` throughout preparation. This package does
not authorize production writes or external invitations by itself.

## 1. Pre-install inventory

1. Confirm the target tenant is `engineering` and its `/contracts` page is the
   management entry point.
2. Export schema-only descriptions of the existing Engineering contracts,
   projects, and group-bindings data sources. Do not export customer rows into
   this repository.
3. Confirm every pilot contract can resolve one project and one active LINE
   group binding from that same project.
4. Confirm the OA bot is a current member of the pilot group and can enumerate
   members.
5. Record a PostgreSQL and Drive backup checkpoint.

## 2. Install PostgreSQL schema

Use the migration-owner connection, not the runtime application role:

```text
psql "$ENG_CONTRACTS_MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f versions/AM-IMP-2026.0828.01/schemas/engineering-contract-evidence.sql
```

The migration URL and runtime `ENG_CONTRACTS_DATABASE_URL` must resolve to
different roles. This schema has no cross-tenant RLS: the database and runtime
credential must be dedicated to Engineering and
`ENG_CONTRACTS_DATABASE_DEDICATED=1` is an explicit production assertion, not a
substitute for verification.

Create or adjust the restricted runtime role according to
`REQUIRED_DATABASES.md`. The runtime role must not own the schema or evidence
tables. Verify privileges using the runtime credential before continuing; do
not grant it ownership merely to make the migration command pass.

## 3. Apply additive Notion projection properties

Compare the existing Engineering contract data source with
`notion-schemas/engineering-contract-projection.json`. Add only missing
properties. Preserve current rows, project/budget/group relations, property
values, page bodies, and URLs.

Do not backfill `已簽署`, a signature time, a signer IP, a bundle hash, or a
signed-PDF URL from assumptions. Existing contracts without PostgreSQL evidence
must project `舊資料／無電子簽署證據` until individually reviewed.

## 4. Configure Drive

Under the existing Engineering Drive root, let the server create the
`工程合約管理` hierarchy described in `REQUIRED_DATABASES.md`. Do not make the root
or contract folders public. Verify the runtime identity can create, read, and
hash a disposable pilot file.

## 5. Configure LIFF and LINE

1. Configure the Engineering contract LIFF app for the HTTPS signer URL.
   Its Endpoint URL must exactly equal `${ENG_PUBLIC_BASE_URL}/contract-sign`;
   the token is transported only as `#token=...`, never in path or query.
2. Permit only the profile/openid scopes needed by the verified identity flow.
3. Confirm the server can verify a LIFF access token and resolve the resulting
   LINE user ID.
4. Confirm the shared OA can list current members of the exact pilot group.
5. Confirm an unrelated member and a former member both fail closed even if they
   possess the group-visible link.

## 6. Configure target environment

Set the names listed in `ENVIRONMENT.md`. Generate a new independent token
pepper. Do not reuse `ENG_QUEUE_ACCESS_KEY`, Portal SSO secrets, meeting-link
secrets, LINE secrets, or a Rental signing secret.

Keep:

```text
ENG_CONTRACTS_SIGNING_ENABLED=0
```

Also keep the feature disabled until `ENG_CONTRACTS_DATABASE_SSL_MODE` is
`verify-full`, or is `verify-pinned` with the exact private-endpoint self-signed
CA plus `ENG_CONTRACTS_DATABASE_CERT_SHA256`. Both modes keep certificate-chain
verification enabled; pinned mode additionally rejects a fingerprint mismatch
and intentionally substitutes that exact pin for hostname/SAN matching only.
Confirm that the configured CA rejects an untrusted certificate (and, for
`verify-full`, a hostname mismatch),
and the trusted proxy mode plus overwritten client-IP header have passed a
deployed request test. On Render, use only `ENG_CONTRACTS_TRUSTED_PROXY_IPS=render`
with `ENG_CONTRACTS_TRUSTED_CLIENT_IP_HEADERS=cf-connecting-ip`; the runtime then
accepts that header only from an internal socket peer and never falls back to
`x-forwarded-for`.

## 7. Deploy the runtime implementation

Deploy the Engineering AM runtime that consumes:

- `config/engineering-contract-workflow.json`;
- `contracts/engineering-contract-api.json`;
- the exact table/column names in the PostgreSQL schema;
- the Notion projection contract;
- server-derived Portal actor and project authorization.

The runtime must create the PostgreSQL transaction and outbox record before any
LINE or Notion side effect. LINE send acceptance, authenticated receipt, and
signature submission each append a separate evidence event.

The management adapter must store `bundle_manifest` as the domain's canonical
JSON array. Its freeze operation must CAS `approved → frozen` while persisting
the exact `frozen_at`, `frozen_by`, manifest, and bundle hash together. Its issue
operation must CAS `frozen → issued` and change only the issued PDF ID/hash,
issuer, issue time, status, and update time.

The signing adapter must follow the schema's evidence order:

1. append `signed` and `submission_received`, then CAS the session to `signed`;
2. insert the normalized immutable signature before CAS to `confirmed`;
3. store and hash the signed PDF and evidence receipt in Drive, insert both
   artifact rows, then CAS to `completed`.

`signing_sessions.status`, `state_snapshot`, and `row_version` are the only CAS
state fields. The public `cs_...` value is stored in `external_session_id`; the
UUID primary key remains internal. The raw token is never persisted.

## 8. Pilot with one non-production contract

1. Use a pilot Engineering project and active pilot group.
2. Designate exactly one current member's LINE user ID.
3. Add a contract body, drawing, quotation, payment milestone, and acceptance
   criterion.
4. Issue the bundle and verify the token expiry is exactly seven days.
5. Send to the group; sign once as the designated member.
6. Attempt the same link as another member and after revocation; both must fail.
7. Verify final PDF, receipt, Drive hashes, event-chain hashes, Notion projection,
   and budget projection.

## 9. Enable and record status

Only after all checks in `VERIFY.md` pass:

1. Set `ENG_CONTRACTS_SIGNING_ENABLED=1` in the target service.
2. Update the target project's local improvement manifest to `Installed`.
3. Add a project-local upgrade record without secret values or production IDs.
4. Mark `Deployed` only after the project owner verifies one controlled
   production signing flow and its evidence package.
