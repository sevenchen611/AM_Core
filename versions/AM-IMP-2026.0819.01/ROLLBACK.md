# Rollback

Rollback is non-destructive.

1. Revert the AM Platform runtime to the prior `claims` module revision.
2. Keep all submitted claims, classifications, audit events, journals, and
   payments intact.
3. Keep the additive Rental columns, account, category, and reclassification
   table; they are backward compatible and must not be deleted during rollback.
4. New `am-claims-v2` claims already accepted by Rental remain authoritative.
5. Record the rollback reason in the tenant upgrade record.

The old form may submit schema v1 claims. Rental must continue to accept those
only with safe heuristics and must fail closed when no account can be inferred.
