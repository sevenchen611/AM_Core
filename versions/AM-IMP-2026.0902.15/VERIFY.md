# Verify

- Run `node tools/dryrun-engineering-party-a-profiles.mjs`.
- Run `node tools/check-upgrade-package.js AM-IMP-2026.0902.15`.
- Confirm schema v9 contains exactly one canonical Party A requirements check.
- Confirm an individual profile with `assets = {}` can be inserted.
- Confirm an individual profile containing a reusable signature is rejected.
- Confirm a company profile without `large_seal` is rejected.
- Confirm `party_a_signature_image` remains an accepted immutable artifact.
- Confirm an individual contract cannot transition to `confirmed` without its
  contract-specific Party A signature artifact.
- Confirm the restricted runtime role retains DML access and no temporary
  migration privilege after production installation.
