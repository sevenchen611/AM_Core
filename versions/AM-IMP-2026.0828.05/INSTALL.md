# Install — AM-IMP-2026.0828.05

## 1. Back up and migrate PostgreSQL

Take the Engineering contract database backup checkpoint. Apply the additive migration with the migration-owner connection and the existing restricted runtime role name:

```text
psql "$ENG_CONTRACTS_MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -v runtime_role="$ENG_CONTRACTS_RUNTIME_ROLE" -f versions/AM-IMP-2026.0828.05/schemas/engineering-contract-draft-review-v3.sql
```

Do not use the runtime credential for DDL and do not grant ownership, `DELETE`, `TRUNCATE`, trigger control, or schema creation. The migration grants only the review-table operations required by the runtime.

## 2. Deploy runtime code

Install dependencies from the lockfile and deploy the AM Platform release. No new Render secret is required. Existing values for the Engineering contract database, private Drive root, LINE Messaging API, trusted proxy, and public base URL remain authoritative.

The public endpoint is `${ENG_PUBLIC_BASE_URL}/contract-review`. Review tokens are transported only in the URL fragment and their SHA-256 digest is stored in PostgreSQL.

## 3. Operator behavior

Open an incomplete draft contract in `/contracts?tenant=engineering`, then use `產生草約並送 LINE 群組確認`. The system resolves the contract project's active LINE group binding, creates a private Drive PDF, records evidence, and sends the public review link to that group.

Do not send a production test message unless an operator has selected the exact contract and group. Formal signing remains subject to the existing independent activation gates.
