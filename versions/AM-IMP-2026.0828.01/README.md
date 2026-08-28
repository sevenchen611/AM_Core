# AM-IMP-2026.0828.01 — 工程合約管理與不可變電子簽署證據

## Outcome

This package defines the installable contract for upgrading Engineering AM's
existing `/contracts?tenant=engineering` register into a project-wide contract
management and electronic-signing tool.

Engineering AM remains the internal management interface. A contract belongs to
one engineering project and one bound LINE group. An authorized internal user
prepares and freezes one contract version, then Engineering AM sends a signing
link to that LINE group. The link permits exactly one named external signer and
expires seven days after issue.

The package contains the schema and machine-readable installation contracts. The
same AMCore branch also includes the matching runtime modules, graphical
workspace, protected APIs, LINE/LIFF signing flow, and executable dry-runs. It
contains no production database ID, LINE user ID, group ID, customer name,
contract content, file, URL, token, or secret value.

## Locked architecture

```text
Engineering AM protected backend
  ├─ prepares contract metadata and required document bundle
  ├─ freezes a version and writes its SHA-256 manifest to PostgreSQL
  ├─ creates one seven-day signing session for one LINE user ID
  ├─ sends the opaque link to the bound LINE group
  └─ projects non-authoritative status summaries to Notion

External signer in LINE / LIFF
  ├─ presents the opaque token
  ├─ completes server-side LIFF access-token verification
  ├─ must equal the designated LINE user ID
  ├─ must still be a member of the contract's active bound LINE group
  └─ signs the exact frozen bundle

Authoritative evidence
  ├─ PostgreSQL: version snapshot, token digest, identity proof, append-only events
  ├─ Google Drive: source files, signature image, issued PDF, signed PDF, receipt
  └─ Notion: retryable management projection only
```

The existing Notion contract row remains useful for project navigation, budget
relations, and management reporting. It is not allowed to create, replace, or
override a PostgreSQL signing event.

Engineering AM provides two deliberately separate version histories. The
contract template version library stores standard contract-body files such as
mudwork, demolition, plumbing/electrical, and carpentry V1/V2/V3 without a
project, counterparty, amount, drawing, quotation, or signing session. A real
project contract may copy one exact template version into its own project-local
contract version, then add drawings, quotation, payment terms, and acceptance
criteria. Neither template versions nor project contract versions are
overwritten in place.

## Required contract contents

Issuing a version must fail closed until all gates pass:

1. Exactly one `contract_body` document is selected and hashed.
2. At least one `construction_drawing` document is selected and hashed.
3. At least one `quotation` document is selected and hashed.
4. At least one payment milestone records an amount or percentage and either a
   fixed payment date/time or a named construction milestone.
5. At least one acceptance criterion records what passes, how it is checked, and
   what evidence is required.
6. The final issued PDF is generated, stored in Engineering Drive, and hashed.
7. The canonical bundle manifest is stored with its SHA-256 digest.

Changing content, files, payment terms, acceptance criteria, amount, project,
counterparty, or designated signer after freeze requires a new version. A frozen
or issued version is never edited in place.

## Signer authority

The signer gate is conjunctive. All checks are required:

- The opaque token is present, its HMAC-SHA-256 digest matches the stored digest,
  its session is `issued`, `sent`, or `opened`, and database time is before its
  expiry.
- Expiry is no later than seven days after issue. Production configuration is
  fixed at `604800` seconds.
- LINE verifies the LIFF access token server-side.
- The verified LINE profile user ID exactly matches
  `expected_signer_line_user_id`.
- That exact user ID is returned by the LINE group membership check for the
  contract's bound group at signing time.
- The tenant-local group binding remains active and belongs to the same project.
- The submitted bundle hash equals the frozen version's bundle hash.

Display names, typed names, query parameters, browser-supplied project IDs, and
possession of the group-visible link are not authority. No fallback may bypass a
failed LIFF, membership, user-ID, project, token, or hash check.

## Evidence and timestamp semantics

All authoritative timestamps are server/database timestamps stored as
`timestamptz`. The UI and PDF display them in `Asia/Taipei` with the offset while
retaining the UTC value in the evidence receipt.

| PDF label | Evidence meaning |
| --- | --- |
| 簽發時間 | The frozen version and signing session were committed. |
| 發送時間 | LINE Messaging API accepted the invitation request. It is not a claim of human delivery. |
| 收件時間 | The designated signer first completed LIFF, exact-user, and current-group-membership verification while opening the version. |
| 簽署時間 | PostgreSQL accepted the signature for the unchanged bundle. |
| IP 位址 | The signing request's normalized client IP obtained through the deployment's trusted-proxy policy. |

The signed PDF and evidence receipt must also carry the contract/version ID,
bundle hash, signed-PDF hash, verified signer name and LINE user reference, and
the evidence-event chain head. Raw tokens, token peppers, LINE access tokens, and
full machine credentials must never appear in a PDF, Notion, browser payload, or
log.

## PostgreSQL ownership

The authoritative schema is `engineering_contracts` and contains:

- `contracts`: mutable management aggregate and Notion/Drive references.
- `contract_versions`: domain lifecycle
  `draft/internal_review/approved/frozen/issued/superseded/voided`, frozen
  snapshots, canonical manifest arrays, and bundle hashes.
- `contract_documents`: hashed contract body, drawing, quotation, and annex files.
- `payment_milestones`: agreed payment triggers, dates/times, amounts, and ratios.
- `acceptance_criteria`: structured acceptance requirements.
- `signing_sessions`: opaque `external_session_id`, one usable designated-signer
  token at a time, mutable `state_snapshot`, and optimistic-CAS `row_version`.
- `signing_events`: append-only, per-session SHA-256 hash chain using the runtime
  columns `session_id`, `actor_kind`, `actor_id`, and `payload`.
- `signatures`: append-only signer and signature evidence.
- `artifacts`: append-only issued/signed PDF and receipt records.
- `integration_outbox`: retryable LINE, Drive-check, and Notion projection work.

The runtime application role must not own the schema and must have no DDL or
trigger-disabling privilege. Database-owner access remains an operational
break-glass capability and must be audited outside the application.

## Workflow

The machine contract is
`config/engineering-contract-workflow.json`. The main path is:

```text
Version: draft → internal_review → approved → frozen → issued

Contract: draft → internal_review → ready_to_issue → issued
          → signed → in_progress → completed → closed

Signing session: issued → sent → opened → signed → confirmed → completed
```

`freezeVersion` is an atomic compare-and-set from `approved` to `frozen` and
locks content, attachments, payment terms, acceptance criteria, the manifest,
and bundle hash. `issueVersion` is a separate `frozen` to `issued` transition
that may add only the issued PDF Drive ID/hash and issue actor/time.

Before signature, a session may become `declined`, `expired`, or `revoked`.
`signed` records the external submission without waiting for PDF generation;
`confirmed` requires immutable signature/submission evidence, and `completed`
requires the hashed signed PDF and evidence receipt. A signed or executing
contract may become `voided` only through a privileged internal action that
appends a reason and retains all prior evidence.

The legacy Notion `狀態` field remains an execution and budget projection. Only a
PostgreSQL `signed` transition may project `已簽約`; a browser request or manual
Notion edit is not signing evidence.

## Permissions

The protected backend should implement distinct capabilities:

- `construction.contracts.view`
- `construction.contracts.manage`
- `construction.contracts.issue`
- `construction.contracts.confirm`
- `construction.contracts.void`
- `construction.contracts.admin`

Every read and write re-loads the target contract, project, budget item, and
group relation before authorization. The server uses the Portal `access.actor`;
it never accepts an operator name from the browser.

## Data boundary

This package is Engineering AM only. Reusing signing techniques from HZHOZO
Rental does not authorize sharing Rental contract records, tenants, databases,
files, customer data, signing tokens, or secrets. Code patterns may be adapted;
live data remains separated.

## Package status

`Ready` means the schema and implementation contract are complete and may be
installed into the Engineering AM target. It does not mean the runtime is
installed or production signing is enabled. The target remains `Ready` until
local verification passes, `Installed` after the controlled local/pilot install,
and `Deployed` only after production evidence is verified by the project owner.
