# Verify

Run from the root AM Platform checkout:

```text
node --check modules/personal-assistant/index.js
node tools/dryrun-personal-line-routing.mjs
node tools/dryrun-line-task-control.mjs
node tools/check-upgrade-package.js AM-IMP-2026.1006.02
node tools/audit-alignment.js
node tools/compare-project-manifests.js
```

The routing dry-run sends synthetic unrecognized private texts through the real module dispatcher and direct event router, asserting zero replies, zero task access and zero group-handler calls. Existing checks cover explicit identity, multi-task creation/confirmation, claims delegation and task-control delegation.

After production deployment, verify the deployed main commit. User acceptance: ordinary private text produces no guide; identity and actual task commands still respond. Do not send user-facing LINE messages without explicit authorization. Record unrelated audit failures separately; do not call overall alignment complete if the audit fails.
