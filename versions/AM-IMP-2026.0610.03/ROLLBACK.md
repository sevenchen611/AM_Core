# Rollback AM-IMP-2026.0610.03

Rollback is not recommended because this standard improves task auditability.

If rollback is unavoidable:

1. Stop writing new task body entries in the `任務控制紀錄` format.
2. Restore the previous project-local task body writer.
3. Keep existing evidence log content already written into task pages.
4. Do not delete source original blocks, images, file links, or AM judgment
   records already stored in task bodies.
5. Remove this package from the project-local manifest only after recording why
   the task body evidence log was disabled.

Rollback must not move project data into AMCore.
