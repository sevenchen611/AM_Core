# Verify AM-IMP-2026.0610.02

Run these checks from AMCore:

```text
node D:\Codex_project\AM_Core\tools\validate-task-source-evidence.js
node D:\Codex_project\AM_Core\tools\check-upgrade-package.js AM-IMP-2026.0610.02
node D:\Codex_project\AM_Core\tools\audit-alignment.js
```

Expected result:

- HOZO AM task pages contain original source evidence.
- SevenAM task pages contain original source evidence.
- Both project manifests include `AM-IMP-2026.0610.02`.
- The package passes package-structure checks.

This validator checks the generated User UI output as an audit surface. The
runtime task sync and hourly reconciliation flows must enforce the same rule
when writing Notion tasks.
