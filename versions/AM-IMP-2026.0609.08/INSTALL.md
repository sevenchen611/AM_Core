# Install

Copy the shared User UI generator into each project and regenerate the User UI.

SevenAM:

```powershell
Copy-Item D:\Codex_project\AM_Core\tools\build-user-ui-connected-preview.js D:\Codex_project\SevenAM\line-oa-webhook\scripts\build-user-ui-connected-preview.js -Force
cd D:\Codex_project\SevenAM\line-oa-webhook
node scripts\build-user-ui-connected-preview.js
```

HOZO AM:

```powershell
Copy-Item D:\Codex_project\AM_Core\tools\build-user-ui-connected-preview.js D:\Codex_project\HOZO_AM\line-oa-webhook\scripts\build-user-ui-connected-preview.js -Force
cd D:\Codex_project\HOZO_AM\line-oa-webhook
node scripts\build-user-ui-connected-preview.js
```
