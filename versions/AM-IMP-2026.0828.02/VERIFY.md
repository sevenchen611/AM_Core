# Verify

## Local

```text
node --check core/group-onboarding.js
node --check server.js
node tools/dryrun-core.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0828.02
node tools/audit-alignment.js
```

The core dry run must prove:

1. `工程 AM`, `工程AM`, `BuildAM`, and `Build AM` all resolve to tenant key `engineering`.
2. The supported-command response includes `綁定 工程 AM 群組：<群組名稱>`.
3. A new engineering binding uses the declared status, capabilities, meeting mode, role, and trade defaults.
4. The parsed Engineering command carries the instruction to assign its project, role, and trade.
5. Existing Forest, Green Hotel AM, HOZO AM 2.0, and legacy HOZO AM 2.0 commands remain compatible.
6. Cross-tenant and duplicate group bindings remain rejected.

## Production

1. Confirm `/health` reports build `engineering-group-onboarding-2026-08-28`.
2. Add the shared LINE OA to a new engineering group.
3. Send `綁定 工程 AM 群組：<群組名稱>` from that group.
4. Confirm the reply starts with `已綁定 工程 AM`, reports status `啟用`, and instructs the administrator to assign the project, role, and trade.
5. Confirm exactly one row was created in Engineering AM's Group Bindings data source and no row was created in any other tenant.
6. Confirm the stored `LINE 群組 ID` matches the current group and the stored name matches the LINE group summary.
7. Select the correct Engineering `專案` relation, group role, and trade.
8. Send a normal message and confirm it is stored only in Engineering AM with the binding and project evidence.
