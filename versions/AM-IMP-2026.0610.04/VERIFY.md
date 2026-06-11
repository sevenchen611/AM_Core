# Verify

Run the shared syntax check:

```text
node --check D:\Codex_project\AM_Core\tools\build-user-ui-connected-preview.js
```

After installing and regenerating each project:

```text
node D:\Codex_project\AM_Core\versions\AM-IMP-2026.0610.04\scripts\verify-archived-task-exclusion.js --project-root D:\Codex_project\SevenAM\line-oa-webhook
node D:\Codex_project\AM_Core\versions\AM-IMP-2026.0610.04\scripts\verify-archived-task-exclusion.js --project-root D:\Codex_project\HOZO_AM\line-oa-webhook
```

Expected result:

- The generator contains archived-task exclusion logic.
- Generated User UI task rows do not contain `data-status="封存"`, `data-status="已封存"`, or `data-status="Archived"`.
- Generated User UI status filter buttons do not include archived task status counts.

