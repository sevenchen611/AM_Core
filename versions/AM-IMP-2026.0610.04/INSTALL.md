# Install

Install separately in each project.

1. Update the project-local User UI generator from AMCore:

```text
Copy-Item D:\Codex_project\AM_Core\tools\build-user-ui-connected-preview.js D:\Codex_project\SevenAM\line-oa-webhook\scripts\build-user-ui-connected-preview.js -Force
Copy-Item D:\Codex_project\AM_Core\tools\build-user-ui-connected-preview.js D:\Codex_project\HOZO_AM\line-oa-webhook\scripts\build-user-ui-connected-preview.js -Force
```

2. Clear existing generated User UI HTML files before regeneration so old archived task pages do not remain as stale files.

3. Regenerate each project's User UI from the project folder.

4. Run the verification script against each project.

Do not delete or modify archived Notion task records. This package only controls User UI import and rendering.

