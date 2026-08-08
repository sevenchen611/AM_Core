# Rollback

1. Re-add `calendar` to the HOZO AM 2.0 tenant module list.
2. Restore the prior `modules/personal-assistant/index.js` behavior that
   delegates Calendar commands and consumes Rental Portal binding codes.
3. Set `config.calendarProjection.enabled=true` only if AM task projection back
   to Rental Calendar is intentionally required.
4. Redeploy AM Platform and verify the old Rental Calendar command flow.

Rollback does not require data migration for this package. The intended forward
change creates only confirmed AM task rows after the user replies
`確認新增`.
