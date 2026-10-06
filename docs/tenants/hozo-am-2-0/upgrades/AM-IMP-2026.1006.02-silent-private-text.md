# AM-IMP-2026.1006.02 — Silent unrecognized private text

Status: Ready. Production deployment pending.

The root Platform personal-assistant module no longer replies with its fixed capabilities guide when private text does not match a supported command. The handler consumes that text silently so the direct router does not substitute its own fallback reply.

Identity queries and delegated task/claims commands keep their existing behavior. No tenant configuration, database or data migration is needed. Verification is recorded in the shared package's VERIFY.md; production status requires verification of the deployed reviewed main revision.
