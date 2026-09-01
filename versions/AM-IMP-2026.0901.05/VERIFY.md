# Verify

- `node --check modules/claims/v3/receiver.js`
- `npm run dryrun:finance-v3-direct`
- `node tools/check-upgrade-package.js AM-IMP-2026.0901.05`
- Confirm the Render deploy is live.
- Send one authorized finance-group `請款` command.
- Confirm membership and web-entry stages succeed, the private message is delivered once, and the queue reaches `delivered` without `invalid_payload`.
- Open the private entry URL and confirm the native `使用 LINE 登入` link navigates to LINE Login.
