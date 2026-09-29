# Verification

```text
node --check server.js
node --test tools/test-line-io.mjs
node --experimental-vm-modules tools/verify-bank-line-reply-intake.mjs
node tools/verify-line-push-timeout.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0929.02
```

The twelve HTTP and provider behavior tests cover recipient override, legacy default, explicit null, invalid IDs, rejected group/member, lookup failure and timeout, lease recovery, equivalent default replay and changed-recipient conflict. Existing signed input, scoped authorization and delivery deduplication are also covered. Bank intake and LINE delivery regressions pass.

Production: confirm `/health` reports the merged main SHA and LINE I/O version 1.1.0. Use the caller-owned key and authorized test group for an explicit recipient push. Retry the same body/key and confirm the same accepted IDs with replayed=true. Change only the recipient under that key and confirm 409 with no additional push. Verify malformed recipient rejection. Preserve receipts outside AMCore. LINE acceptance does not prove receipt, reading or business approval.

Run the AMCore alignment audit when assessing cross-project alignment. Existing legacy folder and manifest gaps are unrelated to this gateway extension and do not justify claiming full alignment.
