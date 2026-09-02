# Install

1. Apply the contract store, workspace, and dry-run files listed in `upgrade.json`.
2. No PostgreSQL schema migration or environment-variable change is required.
3. Run all scripts listed in `requiresScripts`.
4. Deploy the Engineering AM Platform service.
5. Reload HZ-CT-001 and confirm V12 shows the authoritative `internal_review` state with approval and return controls.

Do not repeat the transition or approve the version during deployment verification.
