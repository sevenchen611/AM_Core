# Verify

- `node --check modules/claims/v3/receiver.js`
- `node --check modules/claims/v3/group-entry.js`
- `npm run dryrun:finance-v3-direct`
- `node tools/check-upgrade-package.js AM-IMP-2026.0901.04`
- Confirm the Render deploy is live.
- Send one authorized finance-group `請款` command and confirm the ten-minute entry is delivered once.
- Confirm the queue reaches `delivered` without `entry_response_invalid`.
