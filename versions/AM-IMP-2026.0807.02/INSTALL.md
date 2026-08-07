# Install

1. Deploy the matching Rental Calendar machine API changes first.
2. Configure `HOZO_RENTAL_CALENDAR_BASE_URL` and
   `HOZO_RENTAL_CALENDAR_MACHINE_TOKEN` on the production AM Platform service.
3. Install `modules/calendar/` and the Calendar integration methods in
   `core/bootstrap.js`.
4. Add `calendar` immediately after `personal-assistant` in the HOZO AM 2.0
   module list.
5. Keep Calendar commands delegated by the personal-assistant fallback.
6. Deploy only from the merged AM Core `main` commit.
