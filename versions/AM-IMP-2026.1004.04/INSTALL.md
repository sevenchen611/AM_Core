# Install

Use a private runtime environment with each active collect tenant's configured
Notion parent, attachments data source and Drive root, plus shared credentials.
Never copy credentials or production IDs into the package.

Before deploying the runtime, run separately for `engineering`, `forest`,
`green-hotel`, and `hozo-am-2-0`:

```text
node --env-file=<private-env-path> tools/attachment-retention.mjs --tenant=<key>
node --env-file=<private-env-path> tools/attachment-retention.mjs --tenant=<key> --apply
node --env-file=<private-env-path> tools/attachment-retention.mjs --tenant=<key> --audit
```

The additive installer verifies tenant-parent ownership and stops on incompatible
field types. Missing schemas or Drive configuration refuse binary acknowledgement.
Enable LINE webhook redelivery to retry requests during a durable-intake outage.
Run VERIFY, review the PR, merge into GitHub main and deploy main only. Verify the
live commit, health contract and controlled canaries before marking `Deployed`.
Original storage needs no new token or database.
