# Rollback

1. Redeploy the immediately preceding Engineering AM Platform commit.
2. Do not alter PostgreSQL contract-version rows; this package has no migration.
3. Reload the affected contract before retrying any workflow action, because the previous runtime can commit a transition and then display a false failure.
4. Record the rollback in the Engineering project upgrade log.
