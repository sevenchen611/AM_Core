# Install

1. Apply `schemas/line-directory.sql` to the deployment-owned PostgreSQL database using its migration administrator. Grant only USAGE on `line_directory` and SELECT, INSERT, UPDATE on its two tables to the dedicated IO runtime role. Preserve existing tenant-message RLS; catalog metadata is a separate OA operator directory, never an alternate message access path.
2. Apply the reviewed runtime, provider, router and test changes listed in upgrade.json.
3. Set `AMCORE_LINE_DIRECTORY_ENABLED=1` in the deployment environment after migration. The runtime validates both tables at startup. Disable the flag for deployments not needing a directory.
4. Add `directory:read` to scoped client keys that need their own group/member selector.
5. For the OA owner's cross-group selector, issue a separate private key and add a client entry: `{"id":"oa-directory","tenantKey":"<configured-owner-tenant>","tokenEnv":"<directory-key-env>","groupIds":[],"scopes":["directory:read"],"directoryAllGroups":true}`. This client must have no IO scopes. Store its key only in the deployment and authorized caller's private environment.
6. Run VERIFY.md, merge reviewed main, verify the actual production health SHA and both authenticated endpoints. Refresh caller OpenAPI and Python client; configure `LINE_DIRECTORY_API_KEY` for the authorized selector.

Directory schema migration does not require altering message-table RLS or existing client group allowlists. Discovery does not enroll groups for input capture or send authority; a separate tenant-local binding and IO client configuration are still needed to use a selected group.
