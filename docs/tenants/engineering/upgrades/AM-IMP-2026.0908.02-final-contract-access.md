# Final contract access and control-detail parity — 2026-09-08

Status: Deployed

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

## Deployment record

- Main fix: PR `#129`, commit `050adff8d4fbd1b20e61e890b76f2d35b52a6a17`,
  Render deploy `dep-dafrts15efls73b5sc9g`.
- Completed-state deadline cleanup: PR `#130`, commit
  `3ab8260a161b08ad29abb321657be3472df1d619`, Render deploy
  `dep-dafs0bp42hec73djpb7g` (`Live` on 2026-09-08).
- Production `/health` returned HTTP 200 with JSON.
- The authenticated HZ-CT-001 workspace shows `最終簽署文件` first, opens
  the final PDF, opens a valid JSON evidence receipt, and retains the old file
  as `簽署前凍結版本與附件`.
- The HZ-CT-001 control summary and detail both show
  `簽署與歸檔完成`, both parties signed, holder `無`, next action
  `流程已歸檔`, no outstanding due date, healthy data, and the complete
  signing/final-artifact timeline.
- Forty Engineering dry-run suites, package validation, syntax checks and
  whitespace checks passed. The alignment audit was executed and retained only
  the repository's pre-existing external-project-path and historical-manifest
  findings.
- Verification was read-only: no contract, signature, event, artifact, LINE,
  Notion, Drive, database schema, or Render environment value was changed.
