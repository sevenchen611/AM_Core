# Verify

- Run node tools/dryrun-engineering-contract-acceptance.mjs.
- Run node tools/check-upgrade-package.js AM-IMP-2026.0903.05.
- Confirm a draft version is rejected before acceptance items are derived.
- Confirm a frozen version produces the same checklist on repeated reads.
- Confirm evidence-required items reject a submission with no evidence link and
  SHA-256.
- Confirm an authorized submitter can submit, an unauthorized actor cannot
  review, and a reviewer must record a reason for rework or rejection.
- Confirm reopening an accepted item needs an approver role and a reason.
- In a non-production test tenant, attempt to update/delete an acceptance event
  and confirm the database rejects it. Confirm concurrent appends cannot create
  a forked sequence/hash chain.
- Confirm no acceptance event alone triggers payment, contract completion, LINE
  messaging, or external filing.
