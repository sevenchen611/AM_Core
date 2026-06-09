# Verify AM-IMP-2026.0608.15

Run these checks in each project:

```text
node --check scripts\sync-line-message-judgements.js
node --check scripts\clean-total-control-task-titles.js
node scripts\clean-total-control-task-titles.js
```

Verification passes when the final cleanup dry-run reports:

```json
{
  "matched": 0
}
```

Also confirm that source fields still retain traceability URLs and sync IDs.

## AMCore Check

```text
node D:\Codex_project\AM_Core\tools\check-upgrade-package.js AM-IMP-2026.0608.15
```

