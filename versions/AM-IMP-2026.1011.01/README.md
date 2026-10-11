# Natural-language calendar appointment intake

Status: Installed in the root AM Platform runtime; production verification pending.

The calendar entrance previously required a named event keyword or a time plus a narrowly recognized venue. Timed conversational arrangements at cafes, or arrangements whose venue is not yet specified, could therefore be silently filtered before extraction. Spaces between a number and 點 also prevented time recognition.

Admit dated, timed arrangements with rendezvous/discussion language or common venue names, and accept spaced clock formats. This entrance only sends eligible messages to event extraction. Existing identity resolution, direct-chat scope, tenant boundaries, missing-data questions, two-action cards and explicit owner confirmation still control actual creation. The fallback clock parser also accepts spaces without inventing an activity title or venue.

Synthetic tests exercise natural text through bound-owner intake, extraction, confirmation delivery, duplicate replay and explicit creation; unbound users and group messages remain excluded. Undated/untimed background and calendar queries stay excluded. No credentials, customer source text or production records belong in this package. Standalone HOZO_AM and SevenAM adoption remains separate.
