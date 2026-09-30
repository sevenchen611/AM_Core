# Install

Merge and deploy the gateway change to AM Platform first. Keep
`AMCORE_LINE_IO_REPLY_ENABLED=1` and the existing scoped UOF LINE transport key.
Then deploy the matching UOF application build, which marks approval result
checks as inline actions. No database migration or new secret is required.
