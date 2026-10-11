# Natural-language calendar appointment intake

Status: Deployed in the root AM Platform runtime, verified 2026-10-11. Reviewed PR #281 passed full CI and main `ff62d40725d75f95d4a82f0856a0a2303cc79cc1` is live on the actual Render service and both production health origins.

The calendar entrance previously required a named event keyword or a time plus a narrowly recognized venue. Timed conversational arrangements at cafes, or arrangements whose venue is not yet specified, could therefore be silently filtered before extraction. Spaces between a number and 點 also prevented time recognition.

Admit dated, timed arrangements with rendezvous/discussion language or common venue names, and accept spaced clock formats. This entrance only sends eligible messages to event extraction. Existing identity resolution, direct-chat scope, tenant boundaries, missing-data questions, two-action cards and explicit owner confirmation still control actual creation. The fallback clock parser also accepts spaces without inventing an activity title or venue.

Synthetic tests exercise natural text through bound-owner intake, extraction, confirmation delivery, duplicate replay and explicit creation; unbound users and group messages remain excluded. Undated/untimed background and calendar queries stay excluded. No credentials, customer source text or production records belong in this package. Standalone HOZO_AM and SevenAM adoption remains separate.

16 calendar and 14 central archive tests, private-assistant pause, syntax, package and whitespace checks passed. One requested authenticated original direct event was replayed with its original identity and timestamp. The worker produced one draft and LINE accepted its current card; outgoing archival completed. The original start/end time parsed correctly, while an ambiguous venue remains a visible clarification requirement. Owner confirmation is absent and no Google event was created by recovery. Existing calendar configuration is unchanged. Legacy standalone alignment remains unverified because configured local checkout paths are missing.
