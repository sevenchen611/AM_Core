# Verify

Run the package verifier against each project:

```text
node D:\Codex_project\AM_Core\versions\AM-IMP-2026.0609.03\scripts\verify-task-page-source-format.js D:\Codex_project\SevenAM\line-oa-webhook
node D:\Codex_project\AM_Core\versions\AM-IMP-2026.0609.03\scripts\verify-task-page-source-format.js D:\Codex_project\HOZO_AM\line-oa-webhook
```

Expected result:

- task pages do not include a standalone `<h2>來源證據與對話記錄</h2>` section;
- task pages do not include `判斷補充文字`;
- generated pages contain the LINE archive styles;
- any task page with LINE archive evidence has both metadata header and body markup.

Also run AMCore package and alignment checks:

```text
node D:\Codex_project\AM_Core\tools\check-upgrade-package.js AM-IMP-2026.0609.03
node D:\Codex_project\AM_Core\tools\audit-alignment.js
```
