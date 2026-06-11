# Verify

Run the package verifier against AMCore and each project:

```text
node D:\Codex_project\AM_Core\versions\AM-IMP-2026.0609.09\scripts\verify-task-evidence-media.js D:\Codex_project\AM_Core
node D:\Codex_project\AM_Core\versions\AM-IMP-2026.0609.09\scripts\verify-task-evidence-media.js D:\Codex_project\SevenAM\line-oa-webhook
node D:\Codex_project\AM_Core\versions\AM-IMP-2026.0609.09\scripts\verify-task-evidence-media.js D:\Codex_project\HOZO_AM\line-oa-webhook
```

Expected result:

- task evidence rendering passes attachment records into evidence message cards;
- evidence message cards match attachments by message;
- message rendering includes message media and attachment file links;
- image evidence renders as clickable thumbnails;
- non-image attachments render as clickable file links;
- generated conversation or task pages contain media markup when media evidence
  exists in project-local preview data.

Also run AMCore package and alignment checks:

```text
node D:\Codex_project\AM_Core\tools\check-upgrade-package.js AM-IMP-2026.0609.09
node D:\Codex_project\AM_Core\tools\audit-alignment.js
```
