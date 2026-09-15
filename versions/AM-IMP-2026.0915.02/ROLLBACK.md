# Rollback

Roll back the AM runtime to the preceding reviewed `main` commit, then roll back the compatible Rental/Finance runtime.

Do not delete authority members, external finance identities, membership evidence, delivery rows, or audit history. The added PostgreSQL columns and index are additive and may remain in place. Existing administrator and employee identities are unaffected.
