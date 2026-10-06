# AM-IMP-2026.1006.07 — LINE activity confirmation

Status: Blocked for end-user activation; package/runtime verified locally.

Private activity text gets a four-field preview, explicit owner confirmation and DailyLog Google Calendar creation. Missing/ambiguous details must be clarified; updated drafts require new confirmation. Tenant-local PostgreSQL stores source, supplements, confirmation, frozen API data and stable IDs for retry/restart. A ten-minute single-use pairing binds an encrypted dedicated key to the signed LINE owner. General private auto-replies stay paused; UOF/groups stay on their existing routes.

Actual use requires additive schema/main rollout, a valid production DailyLog calendar key and the human's LINE pairing. No production calendar entry is created during installation or auth validation. Follow the shared package's INSTALL/VERIFY/ROLLBACK instructions; records and secrets remain local to this tenant.
