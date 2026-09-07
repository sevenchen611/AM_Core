# Verify

- Run `node --check core/group-onboarding.js`.
- Run `node --check server.js`.
- Run `node tools/dryrun-core.mjs`.
- Run `node tools/check-upgrade-package.js AM-IMP-2026.0907.01`.
- Confirm the exact Engineering AM command and its quoted, zero-width,
  full-width, and no-space variants all resolve to the engineering tenant.
- Confirm a failed reply-token delivery invokes one idempotent group push.
- Confirm a successful reply-token delivery does not invoke a duplicate push.
- Confirm production health reports build
  `engineering-group-onboarding-confirmation-2026-09-07`.
- Re-send the command once from the target group and verify its tenant-local
  binding before assigning the project, role, and trade.
