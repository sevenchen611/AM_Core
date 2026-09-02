# Verify

- Run `node tools/dryrun-engineering-contract-signing.mjs`.
- Run `node tools/dryrun-engineering-contract-signing-web.mjs`.
- Run `node tools/dryrun-engineering-contract-runtime.mjs`.
- Run `node tools/dryrun-engineering-contract-security-gates.mjs`.
- Confirm a current member of the bound LINE group receives
  `group_member_read_only` and can download the protected PDF.
- Confirm the same member cannot persist signature or identity evidence.
- Confirm a user outside the group receives `GROUP_MEMBERSHIP_REQUIRED`.
- Confirm only the designated signer produces `first_opened` evidence and can
  submit a signature.
