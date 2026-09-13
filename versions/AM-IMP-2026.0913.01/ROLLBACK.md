# Rollback

1. Revert the `AM-IMP-2026.0913.01` UI and test commit from the target project.
2. Keep `AM-IMP-2026.0912.01` and the existing claims authority route mounted.
3. Do not change or delete group, member, audit, outbox, claim, or form records.
4. Re-run `node tools/dryrun-claims-authority-admin.mjs` to confirm the original
   authorization console still works.

This rollback removes only the read-only form catalog and its navigation button.
