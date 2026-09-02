# Verify

- Run `node tools/dryrun-engineering-party-a-profiles.mjs`.
- Run `node tools/dryrun-engineering-contract-management.mjs`.
- Run `node tools/dryrun-engineering-contract-pdf-renderer.mjs`.
- Run `node tools/check-upgrade-package.js AM-IMP-2026.0902.08`.
- Confirm a company profile cannot save without both seals.
- Confirm an individual profile cannot save without a signature.
- Confirm every uploaded signing image is private and its downloaded SHA-256
  matches before save and final rendering.
- Create a draft version by selecting one profile, then edit the master profile;
  confirm the saved version retains its original snapshot.
- Confirm an archived profile disappears from new selection lists without
  affecting existing contracts.
- Confirm the final signed PDF shows company large/small seals or the individual
  signature and still shows Party B's captured signature separately.
