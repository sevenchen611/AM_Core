# Verify

- Run `node tools/dryrun-engineering-party-a-profiles.mjs`.
- Run `node tools/dryrun-engineering-contract-management.mjs`.
- Run `node tools/dryrun-engineering-contract-pdf-renderer.mjs`.
- Run `node tools/check-upgrade-package.js AM-IMP-2026.0902.08`.
- Confirm a company profile cannot save without its large seal.
- Confirm an individual profile cannot save without a signature.
- Confirm every uploaded signing image is private and its downloaded SHA-256
  matches before save and final rendering.
- Create a draft version by selecting one profile, then edit the master profile;
  confirm the saved version retains its original snapshot.
- Confirm an archived profile disappears from new selection lists without
  affecting existing contracts.
- Confirm the final signed PDF shows the company large seal or the individual
  signature and still shows Party B's captured signature separately.

Production result (2026-09-02): PR #104 merged as `2a9769f`; Render deployment
`dep-dabvqk3bc2fs73eusgr0` reached Live. Schema v6 was applied transactionally,
the restricted runtime role reported v6 with forced RLS and no DELETE privilege,
and the authenticated Party A page showed `公司（大章）` plus
`公司大章（必填）` with no small-seal field. Temporary migration CONNECT and
SET ROLE access were revoked after verification. No real Party A record,
signing image, contract version, PDF, signature, or LINE message was created.
