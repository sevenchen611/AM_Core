# Verify

Run:

```text
node tools/dryrun-engineering-contract-store.mjs
node tools/dryrun-engineering-contract-control-recovery.mjs
```

Production verification is read-only and must confirm `schemaReady`,
`partyAProfileSchemaReady`, and `archiveSchemaReady`. A failed check is a
blocker; do not fall back to Notion or a stale status field.
