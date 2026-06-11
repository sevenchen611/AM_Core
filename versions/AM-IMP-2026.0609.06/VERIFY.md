# Verify

Open each generated User UI and check `任務判斷規則`.

The page should show AMCore shared rules plus only the current project's local rules and learned calibration rules.

Also run:

```powershell
node --check D:\Codex_project\AM_Core\tools\build-user-ui-connected-preview.js
node D:\Codex_project\AM_Core\tools\check-upgrade-package.js AM-IMP-2026.0609.06
node D:\Codex_project\AM_Core\tools\audit-alignment.js
```
