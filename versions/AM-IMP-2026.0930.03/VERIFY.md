# Verification

Run `node --test tools/test-line-io.mjs tools/test-line-bindings.mjs tools/test-line-directory.mjs`
and `node tools/test-line-io-sql.mjs node_modules/@electric-sql/pglite/dist/index.js`.
Run `node tools/check-upgrade-package.js AM-IMP-2026.0930.03` after validating
the existing event table and runtime permissions.

For a bound UOF owner, tap a harmless pending-list button. Verify the gateway
returns `method:reply`, one LINE Reply API call, zero Push API calls, and no raw
token in the event feed or UOF state. Repeat the same event ID to confirm it
replays the accepted result without sending again. Check a newly tapped button
receives a new event and reply. With simulated UOF approval, verify a processing
receipt, a separate result-check reply and one durable UOF submission.

Do not execute a real UOF approval only to test the transport.
