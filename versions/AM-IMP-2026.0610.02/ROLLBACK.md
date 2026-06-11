# Rollback AM-IMP-2026.0610.02

Rollback should be avoided because source evidence is part of AM's core task
trust model.

If rollback is unavoidable:

1. Remove the `sourceEvidenceGate` block from the project-local hourly
   reconciliation config.
2. Remove this package from the project manifest.
3. Keep existing task evidence in Notion; do not delete source content already
   written to task pages.
4. Record why the source-evidence gate was disabled.
