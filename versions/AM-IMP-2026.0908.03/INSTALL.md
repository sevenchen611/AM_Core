# Install

1. Apply the runtime and test files listed in `upgrade.json`.
2. Run every command in `VERIFY.md`.
3. Merge the reviewed commit to the Engineering production branch.
4. Wait for the Render service to report the exact commit as Live.
5. Verify `/health`, then open one completed contract through the authenticated
   control center.
6. Confirm the single-contract detail shows the IP evidence rows and the full
   signing/archive event explanations.

No PostgreSQL migration or temporary database-owner access is required. The
existing `signing_events.ip_address inet` column remains the authority.

