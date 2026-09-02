# Verify

- Run every script listed in `upgrade.json.requiresScripts`.
- Run `node tools/check-upgrade-package.js AM-IMP-2026.0902.14`.
- Confirm an individual Party A contract cannot be issued without both distinct
  Party A and Party B LINE signers.
- Confirm each signer must still belong to the contract-bound LINE group.
- Confirm Party A sees only the Party A signing field and is never asked for
  Party B data or identity-document uploads.
- Confirm a non-signer group member sees both applicable signing areas in
  read-only inspection mode and cannot create evidence.
- Confirm Party A may sign before or after Party B without consuming Party B's
  signing authority.
- Confirm internal completion fails until both signatures exist and the final
  receipt contains distinct Party A and Party B hashes.
- Confirm a company Party A contract still uses the frozen company seal and
  does not request a Party A LINE signer.
- In production, verify only with read-only page inspection unless the project
  owner explicitly authorizes assigning a real signer or submitting a signature.
