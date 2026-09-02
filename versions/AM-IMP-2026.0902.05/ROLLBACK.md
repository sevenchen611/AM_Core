# Rollback

1. Redeploy the immediately preceding Engineering AM Platform commit.
2. Do not modify contract-version rows; this package has no schema migration.
3. After rollback, always reload a contract following any workflow error before retrying, because an earlier transition may have committed.
4. Record the rollback in the Engineering project upgrade log.
