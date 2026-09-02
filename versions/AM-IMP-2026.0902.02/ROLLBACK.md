# Rollback

1. Redeploy the Engineering AM service at the commit immediately before this package.
2. Do not delete or rewrite any contract version, attachment, review, archive, or hash evidence.
3. No database rollback is required because this package adds no migration.
4. Existing structured payment and acceptance fields remain compatible with the earlier runtime.
5. Verify that the previous contract workspace and PDF renderer are healthy before closing rollback.
