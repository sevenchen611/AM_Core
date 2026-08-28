# AM-IMP-2026.0828.04 — Google Drive 隱私稽核修正

## Outcome

This package repairs the shared Google Drive privacy gate used by Engineering
AM contract templates, contract source attachments, and immutable signing
artifacts.

The former request selected `permissionDetails` as a top-level Drive file
field. Google Drive rejects that malformed partial-response selector with HTTP
400 before a contract file can be uploaded. The repaired gate uses the official
`permissions.list` endpoint, requests nested permission details correctly,
follows pagination, and continues to reject `anyone` and `domain` sharing.

## Safety

- Private user/group permissions remain allowed.
- `anyone` and `domain` permissions fail closed, including link sharing.
- Shared-drive items use `supportsAllDrives=true`.
- Google error details are logged without access tokens, file contents, or
  credentials; the browser receives only the stable status error.
- No production Drive ID, contract file, customer data, or secret is stored in
  this package.

## Scope

The change is in the shared Drive adapter. It repairs every caller of
`auditDrivePrivate`, including the Engineering contract template library and
project contract attachments. It does not change Drive ownership or sharing.

## Status

`Ready` after local dry-runs and package validation. Mark the Engineering AM
target `Deployed` only after a private DOCX template uploads successfully in the
production contract template library and the resulting Drive item remains
non-public.
