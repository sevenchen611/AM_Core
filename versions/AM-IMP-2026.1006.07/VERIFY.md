# Verify

```text
node --check server.js
node --experimental-vm-modules --test tools/test-leaf-calendar.mjs
node --experimental-vm-modules tools/verify-private-assistant-pause.mjs
node --experimental-vm-modules tools/verify-attachment-webhook.mjs
node --experimental-vm-modules tools/verify-bank-line-reply-intake.mjs
node tools/dryrun-personal-line-routing.mjs
node tools/dryrun-core.mjs
node tools/check-upgrade-package.js AM-IMP-2026.1006.07
node tools/audit-alignment.js
node tools/compare-project-manifests.js
```

The seven calendar tests exercise actual SQL/schema with disposable PGlite and a real signed webhook handler. Covered: tenant RLS and owner isolation, encrypted key and single-use pairing, source/confirmation evidence, missing data, cancellation, stale revisions, multi-event ambiguity, expired confirmation, key rotation, restart, lease fencing, replay, permanent errors and an uncertain timeout after a mocked Google acceptance. Zero real Google events or LINE messages are sent.

After schema/main deployment, verify live health. Probe DailyLog auth only with an empty invalid body. A valid key should return 400 INVALID_REQUEST, not 401. Do not call create with a valid activity until the human has approved that activity. Only an actual successful API response with matching requestId and an event ID permits 已加入. End-user acceptance requires the human's own pairing and confirmed event.

Overall standalone-project alignment must not be claimed if the existing manifest audit fails. Secret values, real messages, drafts and production logs stay outside AMCore.
