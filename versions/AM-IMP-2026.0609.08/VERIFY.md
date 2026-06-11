# Verify

Open each generated User UI and check `Environment data`.

Rows should be grouped by type, with keys sorted alphabetically inside each group. `USER_UI_USERNAME` should appear directly above `USER_UI_PASSWORD`. Sensitive values should remain masked.

Also run:

```powershell
node --check D:\Codex_project\AM_Core\tools\build-user-ui-connected-preview.js
node D:\Codex_project\AM_Core\tools\check-upgrade-package.js AM-IMP-2026.0609.08
node D:\Codex_project\AM_Core\tools\audit-alignment.js
```
