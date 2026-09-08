# Install

1. Apply the package files to the AM Platform runtime.
2. Run every command in `VERIFY.md`.
3. Merge the reviewed commit to the production branch used by the Engineering
   Render service.
4. Wait for the Render deployment to report Live and verify `/health`.
5. Open the authenticated Engineering contract workspace and control center.
6. Verify HZ-CT-001 read-only: the final signed PDF opens, the detail status is
   archived, both parties are signed, and the event timeline is populated.

No PostgreSQL migration, Render environment change, temporary database owner,
new password, LINE delivery, or contract workflow action is required.
