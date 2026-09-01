# Verify

- `node --check modules/claims/v3/group-entry.js`
- `node --check modules/claims/v3/receiver.js`
- `npm run dryrun:finance-v3-direct`
- `node tools/check-upgrade-package.js AM-IMP-2026.0901.06`
- Confirm Render deploys the merged `main` commit and `/health` remains healthy.
- In an authorized finance group, send exactly `請款` once.
- Confirm the same group receives one production entry message and the applicant receives no private entry message.
- Confirm the durable queue reaches `delivered` with one successful attempt and a provider acknowledgement.
