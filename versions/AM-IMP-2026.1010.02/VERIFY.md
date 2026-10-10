# Verify

```text
node --experimental-vm-modules --test tools/test-leaf-calendar.mjs
node --test tools/test-central-archive.mjs
node --experimental-vm-modules tools/verify-private-assistant-pause.mjs
npm run check
node tools/check-upgrade-package.js AM-IMP-2026.1010.02
node tools/audit-alignment.js
node tools/compare-project-manifests.js
git diff --check
```

Real SQL tests cover same-draft direct/named supplementation, no unchanged-card resend on legacy edit, ambiguous target suppression, hard-missing creation denial, direct acceptance of displayed valid year assumptions with confirmation evidence, one-time legacy refresh, stale-button invalidation, payload/source preservation and confirmation-only writes. Existing immutable retry, owner/tenant boundaries and signed durable webhook tests remain required.

Validate a synthetic Flex card with LINE's non-sending message validation endpoint. Production checks verify exact deployed commit, unchanged configured tenants, and acceptance of the original intended refreshed card without confirming or creating the event. Source records, identifiers and API credentials must not be copied into this package. Full standalone alignment remains separate from this root-runtime calendar change.
