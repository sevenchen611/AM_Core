# Rollback

1. Do not restore the old reusable-signature requirement; it conflicts with the
   approved privacy design and would block individual Party A profile creation.
2. If installation fails, rely on the transaction rollback and inspect the
   reported constraint before retrying.
3. If a later runtime issue appears, keep schema v9 installed and roll back only
   the affected runtime commit. The constraint changes are backward compatible.
