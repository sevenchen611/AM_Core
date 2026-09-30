# Installation

1. Review and merge this runtime change into GitHub `main`.
2. Verify the existing LINE I/O event table permits the runtime role to
   update its own rows. No new table or database credential is needed.
3. Set `AMCORE_LINE_IO_REPLY_ENABLED=1` on the AM Platform service. Its existing
   `LINE_CHANNEL_SECRET` encrypts the short-lived tokens. Restart and verify
   the reviewed commit is serving before enabling UOF reply mode.
4. On UOF, set private `LINE_IO_REPLY_ENABLED=1` and restart the UOF backend.
   The existing scoped LINE I/O key and group binding remain in place.
