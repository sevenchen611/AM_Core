# Verify

Run:

```text
node --check modules/construction/contract-completion.js
node --check modules/construction/contracts.js
node --check core/contract-store.js
node tools/dryrun-engineering-contract-completion.mjs
node tools/dryrun-engineering-party-a-profiles.mjs
node tools/dryrun-engineering-contract-control-routes.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0908.01
```

Production read-only checks:

1. Confirm the deployed commit is live.
2. Open an individual-Party-A contract whose session is `confirmed`.
3. Confirm the Party A assignment selector/button is absent.
4. Confirm the page says internal confirmation is complete and offers only
   `繼續產生最終歸檔`.
5. Confirm a completed-session fixture contains no Party A assignment or final
   archive action.

Submitting the final archive action changes contractual production state and is
not part of a read-only deployment check. It requires explicit user approval.
