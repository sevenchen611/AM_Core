# Rollback

Restore the previous UOF DLL to omit the inline property from background pushes if needed. Revert the gateway commit through reviewed GitHub main and redeploy. Keep all approval records, event cursors, outbox records and private configuration; do not retry UOF approval submission as part of a presentation rollback.
