# Verify

- Run `node --test tools/test-line-bindings.mjs tools/test-line-io.mjs tools/test-line-directory.mjs`.
- Run the SQL persistence suite and the package/alignment checks.
- Verify 12 actions, full wrapped filenames, their own URIs, disabled rows,
  rejection of 13 actions, invalid display text, unsafe URIs and foreign senders.
- Verify changing display text under an existing idempotency key fails.
- Validate a synthetic Flex message using LINE's validate endpoint without
  sending it. After deployment verify the exact commit through `/health`.
- In the UOF caller verify a four-attachment case is one bubble, overflow keeps
  every file reachable, and browsing performs no approval.
