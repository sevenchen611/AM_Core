# Verify — AM-IMP-2026.0828.03

Run:

```text
node --check modules/groups/index.js
node --check core/group-onboarding.js
node --check server.js
node tools/dryrun-groups.mjs
node tools/dryrun-core.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0828.03
```

Production verification:

1. The group console reports that V2 is ready.
2. A full-list-capable OA still replaces the map from LINE profiles.
3. A LINE 403 account restriction returns success in limited mode and does not erase webhook-observed members.
4. A member who sends a message appears in the same group's `成員對照` with a stable LINE user ID.
5. Re-running onboarding merges the command sender without resetting the project, role, trade, status, or capabilities.
6. No other tenant's group or member data changes.
