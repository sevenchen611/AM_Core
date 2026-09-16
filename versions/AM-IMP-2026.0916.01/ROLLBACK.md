# Rollback

1. Revert the runtime commit and redeploy AM Platform.
2. Before rollback, set any external groups back to `internal_v3`; older runtimes ignore the column but will again require Finance membership.
3. Do not delete the `claim_mode` column or its audit history. Leaving the additive column and RLS read policies is safe.
4. Existing claims, selector sessions, member denials, and form assignments remain intact.
