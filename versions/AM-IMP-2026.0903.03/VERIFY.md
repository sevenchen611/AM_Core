# Verify — AM-IMP-2026.0903.03

Run:

    node tools/dryrun-engineering-contract-action-task-bridge.mjs
    node D:\Codex_project\AMCore\tools\check-upgrade-package.js AM-IMP-2026.0903.03

Confirm the dry run proves:

1. A signing-confirmation state produces a formal task intent with project goal and evidence.
2. Re-running the same state returns deduplicated.
3. A different contract action uses a different semantic key.
4. Missing project goal or source evidence yields a candidate, not a formal task.
5. Cross-tenant evidence is rejected.
6. The returned delivery contract records zero Notion, LINE, or production-task writes.

Project-local deployment verification must additionally prove its adapter preserves the source evidence and uses the returned idempotency key before any task write.
