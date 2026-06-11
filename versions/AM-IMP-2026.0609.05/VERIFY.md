# Verify

Run the verifier separately for each project:

```powershell
node D:\Codex_project\AM_Core\versions\AM-IMP-2026.0609.05\scripts\verify-task-deadline-standard.js --project SevenAM --root D:\Codex_project\SevenAM\line-oa-webhook --tasks-env SEVEN_TASKS_DATA_SOURCE_ID
node D:\Codex_project\AM_Core\versions\AM-IMP-2026.0609.05\scripts\verify-task-deadline-standard.js --project HOZO_AM --root D:\Codex_project\HOZO_AM\line-oa-webhook --tasks-env HOZO_TASKS_DATA_SOURCE_ID
```

Then run:

```powershell
node D:\Codex_project\AM_Core\tools\check-upgrade-package.js AM-IMP-2026.0609.05
node D:\Codex_project\AM_Core\tools\audit-alignment.js
```
