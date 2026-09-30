# Rollback

Disable UOF `LINE_IO_REPLY_ENABLED` first so interactions use the existing Push
path. Disable AM Platform `AMCORE_LINE_IO_REPLY_ENABLED` afterward. Existing
encrypted reply fields remain private and expire with their event rows. No
native approval journals or existing push records are changed by this package.
