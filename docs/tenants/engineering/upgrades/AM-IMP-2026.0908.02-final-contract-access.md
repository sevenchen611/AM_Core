# Final contract access and control-detail parity — 2026-09-08

Status: Installed

## Scope

- Make control-center summary and detail use the same authoritative signing
  projection.
- Restore the completed status, both signing parties and the event timeline in
  the detail drawer.
- Show the final signed contract PDF and evidence receipt directly in the
  completed contract workspace.
- Keep the pre-signing frozen PDF available as immutable audit history.
- Verify private Drive state and SHA-256 server-side before returning files.

## Safety boundary

This release is read-only with respect to business data. It requires no schema
migration, database owner permission, Render secret, new signature, LINE
message, or contract transition. Private Drive ids and signing evidence are not
placed in the browser.

## Verification status

Local implementation and focused regression tests are installed. Production
deployment evidence will be recorded only after the Engineering Render service
is Live and HZ-CT-001 passes the read-only workspace and control-detail checks.
