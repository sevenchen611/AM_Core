# Install AM-IMP-2026.0608.15

Install this version separately in each project.

## 1. Update Title Generation

Patch the project-local:

```text
scripts\sync-line-message-judgements.js
```

The `buildTaskName` logic must:

- Prefer `conversationDisplayName` or another human-readable conversation label.
- Remove Notion page IDs and LINE IDs from the title.
- Keep technical IDs in source/debug fields only.

## 2. Add Cleanup Script

Add:

```text
scripts\clean-total-control-task-titles.js
```

Run dry-run first:

```text
node scripts\clean-total-control-task-titles.js
```

Then write:

```text
node scripts\clean-total-control-task-titles.js --write
```

## 3. Update Records

After verification, update:

```text
docs\project-improvement-manifest.md
docs\upgrades\
```

