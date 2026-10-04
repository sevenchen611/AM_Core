# Verify

```text
node --test tools/test-attachment-retention.mjs
node tools/dryrun-collect-attachment-archive.mjs
node tools/dryrun-core.mjs
node tools/dryrun-line-download.mjs
node tools/check-upgrade-package.js AM-IMP-2026.1004.04
node tools/compare-project-manifests.js
node tools/audit-alignment.js
```

Prove a synthetic 40,647,423-byte PDF archives in HOZO and other/future tenants
without the old opt-in or a buffered preview. Test source linkage, restarts,
redelivery, transient transfers, failed index updates after upload, source expiry,
retry exhaustion, wrong size/ownership/checksum, ambiguous routing and missing configuration.
Verify redelivery respects persisted retry timing and an index failure retains source digests.

Production acceptance: verify the deployed SHA and health archive contract; all
active collect tenants must be configured and ready after startup recovery. Audit
historical gaps. Use controlled large-PDF/CAD/image/video sources and compare exact
Drive bytes/hash. Force a failure and verify honest state and restart recovery.
Record any unperformed production canary. Fixtures never send to real LINE groups.
