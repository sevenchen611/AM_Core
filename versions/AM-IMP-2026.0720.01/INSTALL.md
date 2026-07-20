# Install

1. Apply the AMCore `modules/meetings/index.js` change to the target project runtime.
2. Confirm the target project has `publicBaseUrl` and `publicLinkSecret` configured.
3. Confirm the target project has the meetings module and tasks module enabled.
4. Confirm group bindings maintain `成員對照` JSON so owner dropdowns can list group members.
5. Optional: configure `config.meetings.liffId` for the tenant to enable LINE LIFF identity lookup on the review page.
6. Deploy the target project service from its own project folder.

Do not copy Notion database IDs, LINE credentials, Render secrets, or live records between projects.

## Operational Caveat

Pending review sessions are in memory in this version. Avoid restarting the service during an active meeting todo review. If a restart happens, use the meeting record as the source and rerun the old direct task creation path manually if needed.
