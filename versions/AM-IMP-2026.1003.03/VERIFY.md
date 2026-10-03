# Verify

Run `node --test tools/test-line-io.mjs tools/test-line-bindings.mjs tools/test-line-directory.mjs tools/test-line-capture-latency.mjs`
and `node tools/check-upgrade-package.js AM-IMP-2026.1003.03`.

Verify ordinary capture performs one binding list refresh, lifecycle changes still
refresh, and failed directory or binding capture cannot append an event. Use a
local PostgreSQL-compatible database to verify expiry and fresh-row read results,
including a pending row that expires during the query. Retain revocation,
membership-change, reply, push and cursor-safety regression coverage.

After deployment, confirm the health commit includes this reviewed change. Measure
real LINE operations separately from read-only endpoint benchmarks; the latter
cannot prove a complete user response meets one or two seconds.
