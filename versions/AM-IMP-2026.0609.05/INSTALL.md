# Install

Run the installer separately inside each project target.

SevenAM:

```powershell
node D:\Codex_project\AM_Core\versions\AM-IMP-2026.0609.05\scripts\install-task-deadline-standard.js --project SevenAM --root D:\Codex_project\SevenAM\line-oa-webhook --tasks-env SEVEN_TASKS_DATA_SOURCE_ID
```

HOZO AM:

```powershell
node D:\Codex_project\AM_Core\versions\AM-IMP-2026.0609.05\scripts\install-task-deadline-standard.js --project HOZO_AM --root D:\Codex_project\HOZO_AM\line-oa-webhook --tasks-env HOZO_TASKS_DATA_SOURCE_ID
```

After installation, regenerate the project User UI from the project folder.
