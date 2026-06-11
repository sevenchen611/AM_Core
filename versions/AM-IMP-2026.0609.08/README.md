# AM-IMP-2026.0609.08 - Environment data grouped sorting

This upgrade improves the User UI Environment data page.

Environment rows are now sorted by control group first, then by type and key:

1. Credential
2. Secret
3. Notion ID
4. Database ID
5. LINE
6. Report
7. URL
8. Runtime
9. Config

Credential rows keep paired login settings together. `USER_UI_USERNAME` is shown directly above `USER_UI_PASSWORD`.

Sensitive values remain masked. This package changes display order only and does not copy or store project environment values in AMCore.
