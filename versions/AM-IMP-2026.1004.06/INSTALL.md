# Install

1. Review and merge runtime changes into GitHub main. Do not deploy local dirty checkouts.
2. For each active tenant separately run node tools/attachment-retention.mjs --tenant=<key> --apply using that tenant's existing parent, attachment data source and Drive root. This adds the four new source identity fields plus prior retention fields; no production IDs are shipped.
3. Deploy the shared AM Platform runtime. Startup and minute patrol resume durable queues and migrate historical managed originals in bounded batches. Keep source files until verified success. No standalone HOZO_AM/SevenAM install or deployment is implied.
4. Independently verify each tenant's schema, health, originals, checksums and link-only index before recording Deployed.
