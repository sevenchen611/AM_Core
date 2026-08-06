# Install

## Rental

1. Apply the Rental Calendar foundation PR containing migration `0042_calendar_v2_foundation.sql`, runtime `ensureCalendarV2Schema`, binding APIs and tests.
2. Set these Pages secrets in Rental; never commit their values:
   - `AM_CALENDAR_MACHINE_TOKEN`
   - `CALENDAR_BINDING_CODE_SECRET`
   - `CALENDAR_IDENTITY_HMAC_SECRET`
   - `CALENDAR_IDENTITY_ENCRYPTION_SECRET`
3. Keep the existing `admin_users.id` as the canonical `person_id`.
4. Verify `/api/calendar-v2/line-bindings/code` requires a logged-in Portal user.

## AM Platform

1. Apply the shared changes in `core/bootstrap.js` and `modules/personal-assistant/index.js`.
2. Add these AM Platform variables/secrets:
   - `HOZO_RENTAL_CALENDAR_BASE_URL=https://rental.hozorental.com`
   - `HOZO_RENTAL_CALENDAR_MACHINE_TOKEN` equal to Rental's `AM_CALENDAR_MACHINE_TOKEN`.
3. Run both personal LINE dry runs and the standard AMCore checks.
4. Deploy from the actual AM Platform production checkout only after Rental's API is deployed and smoke-tested.

The AM service never logs or returns the machine token. The LINE user ID is sent
only in the HTTPS request body to the Rental endpoint and is not written to
AMCore data.
