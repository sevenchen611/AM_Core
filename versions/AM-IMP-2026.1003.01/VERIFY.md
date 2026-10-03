# Verify

Run the three LINE transport test suites:

```text
node --test tools/test-line-io.mjs tools/test-line-bindings.mjs tools/test-line-directory.mjs
node tools/check-upgrade-package.js AM-IMP-2026.1003.01
```

Confirm that all three identity requests start before a blocked mock resolves,
overlapping reads share them, completed and failed proofs are discarded, fresh
delivery starts its own requests, and membership changes invalidate pending
checks. Test stale bound snapshots after database revocation, suspended and
expired states, fresh Reply/Push after a second member joins, and rejection of
new events after suspension. Confirm four-group maximum parallelism, configured
order and failure of the whole event page after group assignment withdrawal.

After a reviewed main deployment, measure received-at to accepted reply using a
read-only command and card navigation. Report actual median and slow responses;
do not use health timings as command timings or submit a real approval for a
transport test. Provider latency can still keep a response above two seconds.
