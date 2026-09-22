# Verify

1. Run `node --check modules/claims/index.js`.
2. Run `node --check modules/claims/authority-integration.js`.
3. Run `node tools/dryrun-claims.mjs`.
4. Run `node tools/dryrun-claims-authority-routing-login.mjs`.
5. Run `node tools/check-upgrade-package.js AM-IMP-2026.0922.01`.
6. Confirm an opaque group reference resolves only within its tenant and that
   duplicate reference targets fail closed.
7. After the coordinated Rental release, confirm the queued rejected claim event
   is accepted once and the LINE message contains the claim number and return
   reason.
