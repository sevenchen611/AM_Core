# Install

Deploy reviewed GitHub main to AM Platform and confirm its health commit first.
No schema migration, LINE channel replacement or key change is needed.

In UOF enable only the chosen pilot in `LineIo:DirectAccounts` (empty by default).
Deploy the consumer's direct source and destination validation and setup labels.
Use the authenticated, CSRF-protected `/api/line-io/binding/conversation` with the
current binding id, expected group id, expected user id and `mode: direct`.
The gateway management equivalent is `/api/v1/line/bindings/{id}/conversation`.
Do not accept a user id supplied as a new destination, and do not edit database
rows or encrypted consumer state while its process is running.

Notify the pilot to send a fresh `待簽` in the OA's private conversation. Older
group card intents retain their original destination and cannot authorize the
new conversation. Keep all other bindings and access grants unchanged.
