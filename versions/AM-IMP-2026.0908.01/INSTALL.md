# Install

1. Apply the package files to the AM Platform runtime.
2. Run the verification commands in `VERIFY.md`.
3. Deploy the verified commit to the Engineering Render service.
4. Reload the Engineering contract workspace.
5. For a session already in `confirmed`, verify that only the final-archive
   continuation action is visible. Do not submit it during read-only deployment
   verification.

No PostgreSQL migration, environment change, password, or temporary owner
access is required.
