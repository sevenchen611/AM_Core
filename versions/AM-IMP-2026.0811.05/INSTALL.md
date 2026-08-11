# Install

1. Start from AM Platform with `AM-IMP-2026.0804.01` already deployed.
2. Install the updated `modules/claims/index.js` and `tools/dryrun-claims.mjs`.
3. Keep the existing HOZO AM 2.0 claims event token and binding governance.
4. Deploy AM Platform before deploying the Rental emitter so the receiver
   accepts the new structured event first.
5. Run every command in `VERIFY.md` before production deployment.

This package adds no database migration, secret, LINE group ID, or claim data.
