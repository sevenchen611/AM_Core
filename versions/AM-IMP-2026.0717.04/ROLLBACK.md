# Rollback — AM-IMP-2026.0717.04

The safe rollback is **not** tenant-wide access.

1. Set Core and Portal authorization mode to `owner-only`.
2. Keep `AMCORE_ENABLE_EMERGENCY_PIN=0` unless an explicitly approved emergency session is required.
3. Leave additive Portal columns and the audit table in place; do not drop them during an incident.
4. Stop Portal account/group edits while investigating.
5. Restore the previous application build only if needed, but keep AM entry restricted to platform owners.
6. Verify the single LINE webhook and system-principal processing remain tenant-isolated.
7. After repair, return to `shadow`, rerun all dry-runs and owner review, then switch to `enforce` again.

If only one module is faulty, remove or disable that module route for the affected tenant rather than reopening all groups. Preserve audit rows and project-local migration outputs for incident review.
