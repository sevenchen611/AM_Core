# Verify

Run:

```text
node --test tools/test-central-archive.mjs
node --experimental-vm-modules --test tools/test-leaf-calendar.mjs
node --experimental-vm-modules tools/verify-private-assistant-pause.mjs
npm run check
node tools/check-upgrade-package.js AM-IMP-2026.1010.01
node tools/audit-alignment.js
node tools/compare-project-manifests.js
git diff --check
```

The new real-PGlite regression reproduces `archive_outbound_identity_conflict` on the first calendar-card send before the fix. After the fix, evidence is stored before mocked LINE transmission, JSON-equivalent retries pass, provider acceptance is recorded, and changed content using the same retry key remains rejected before transmission.

Additional real-SQL transport coverage tests both push and reply for user, group and room conversations: twelve successful mocked sends, six accepted evidence records, and changed-content denial on every path. All callers of the central archive observer, including the separate finance notification transport, use this same normalization. Legacy standalone LINE services are separate deployment targets.

The recovery regression uses two source-backed drafts with failed preview delivery. Dry run changes no scheduling, applying resumes only the unlocked draft, payload/evidence/revision are preserved, no calendar write occurs before confirmation, and saved/locked/expired records are excluded from recovery.

Production read-only diagnosis confirmed intake completion with an unprompted draft and repeated preview delivery attempts. LINE's non-sending validation API accepted the card; JSON round-trip comparison failed on optional button colors. No user source data or records are copied into this package.

After reviewed deployment, verify live commit, calendar configuration and paused-assistant health. Observe an intended activity's preview and use explicit owner confirmation for real insertion. Missing year/details remain subject to clarification. Validation is not evidence of a delivered message or created calendar event.
