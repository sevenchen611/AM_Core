# Install

1. Take a backup checkpoint of the Engineering contract PostgreSQL database.
2. Apply the additive v4 migration with the migration-owner connection and restricted runtime role:

```text
psql "$ENG_CONTRACTS_MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -v runtime_role="$ENG_CONTRACTS_RUNTIME_ROLE" -f versions/AM-IMP-2026.0831.04/schemas/engineering-contract-line-archive-v4.sql
```

3. Deploy the updated Engineering AM runtime.
4. No new secret or environment variable is required.
5. Open the contract workspace and use `補封存既有版本對話` once for contracts with earlier draft-review sends.
6. Backfill only reads the contract's bound Engineering LINE message and attachment data; it does not send LINE or change contract status.
