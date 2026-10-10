# LINE calendar preview delivery recovery

Status: Deployed in the AM Platform root runtime, verified 2026-10-10. PR #276 passed full CI and main `aedbf53a1082fe345df32ecef262ff4f9a6755fe` is live on the actual AM Platform service. Standalone project installation remains separate.

Calendar confirmation cards contain optional `undefined` properties. Central archive stores JSONB before sending, then compares the stored JSON against the original JavaScript object. JSON omits those properties, so even the first delivery incorrectly fails with `archive_outbound_identity_conflict` before reaching LINE. Drafts remain unprompted and retry indefinitely.

Normalize outgoing messages to their HTTP JSON representation before persistence and replay comparison. Keep the existing conflict guard for actual content changes. Recognize dated book-club announcements as activity candidates so incomplete invitations can request details through the existing confirmation flow.

This supports conversation-to-action control by restoring delivery of auditable source-backed drafts and explicit owner confirmation. No source messages, live records, credentials or personal identifiers are included. No calendar write occurs until the existing owner confirmation succeeds.

The common archive observer covers all root-runtime push/reply callers and user/group/room conversations. Production recovery advanced one existing unprompted preview; LINE accepted it and its outgoing archive completed. Its owner confirmation remains pending. No calendar event was created during recovery.
