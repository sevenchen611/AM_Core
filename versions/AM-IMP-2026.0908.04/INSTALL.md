# Install

1. Apply the runtime and test files listed in `upgrade.json`.
2. Run every command in `VERIFY.md`.
3. Merge the reviewed commit to the Engineering production branch.
4. Wait for the Render service to report the exact commit as Live.
5. Verify `/health`.
6. Open the original LINE invitation for one completed contract as a current
   member of its bound LINE group.
7. Confirm the page is final-contract read-only and loads the final signed PDF.

No PostgreSQL migration, temporary database owner or new environment value is
required. Keep the configured signing token pepper stable because it is part of
the durable lookup for all previously issued opaque invitation tokens.
