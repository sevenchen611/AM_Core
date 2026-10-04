# Rollback

Revert the reviewed retrieval service and its server/transport integration in a
new reviewed main PR. Keep the durable Drive archive, saved indexes, original
checksums and existing permissions intact. Do not delete originals or undo the
completed Notion-to-Drive migration. Retrieval source records remain tenant-local
general conversations. Verify normal webhook, archive and transport behavior.
