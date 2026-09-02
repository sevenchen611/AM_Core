# Install

1. Apply the runtime and dry-run changes listed in `upgrade.json` to the Engineering AM Platform service.
2. No PostgreSQL migration or environment-variable change is required.
3. Run the contract-management, workflow-API, and draft-review dry-runs.
4. Deploy the Engineering AM service.
5. Reload a contract already transitioned by the former runtime and confirm its authoritative database state is displayed.

Do not repeat an already-committed workflow transition merely because the former UI displayed a failure alert.
