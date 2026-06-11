# Rollback

To roll back this UI format change:

1. Restore the previous project-local `reports/followup-confirmation-prototype.html`.
2. Remove the `AM-IMP-2026.0609.04` row from the project manifest, or mark it `Deprecated` if the project intentionally rejects this format.
3. Keep the project-local upgrade record as an audit note and add the rollback reason.

Rollback must be done separately for HOZO AM and SevenAM.

