# Rollback

1. Pause new contract confirmations.
2. Roll back the application runtime to the preceding deployed revision.
3. Keep the v7 schema and immutable `party_a_signature_image` artifacts in
   place; the previous runtime ignores the additional artifact kind.
4. Do not recreate reusable individual signatures in Party A profiles.
5. If a contract was signed under v7, preserve its PDF, receipt, signature
   artifact and event evidence even if the runtime is rolled back.

The schema migration is intentionally forward-compatible and should not be
reversed by deleting signing evidence.
