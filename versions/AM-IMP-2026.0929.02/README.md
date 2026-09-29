# Per-request LINE group notification recipient

Status: Ready. Extends AM-IMP-2026.0929.01 with an optional `notifyUserId` on `POST /api/v1/line/messages`.

```json
{"groupId":"C00000000000000000000000000000000","notifyUserId":"U00000000000000000000000000000000","text":"Today's report"}
```

`notifyUserId` must be a LINE Messaging API user ID for a member of the authorized destination group. Omit it to preserve the client's configured default; pass `null` for a report without @. An empty string or malformed ID returns `400 invalid_notify_user`. The response reports the effective recipient.

Before a new push, LINE group member profile lookup must succeed. A missing member returns `403 notify_user_unavailable`; unavailable lookup or timeout returns `503 notify_lookup_unavailable` without push. Lookup has a five-second timeout, and a failed lookup releases the send lease so the original key can be retried. Group allowlists, tenant ownership, input filtering and transport-only behavior remain in force.

Idempotency identity includes the effective notification recipient. Changing it while reusing the same key returns `409 idempotency_conflict`. Equivalent omitted-default and explicit-default requests replay the same result, including results created before this extension. Completed replays require current group authorization but do not re-query membership or re-send.

Notifications are group messages visible to group members. This extension adds no direct-message route or new group permission. The API contract is version 1.1.0 under the same `/api/v1/line` URLs.

OpenAPI and Python client are maintained at `versions/AM-IMP-2026.0929.01/openapi.json` and `versions/AM-IMP-2026.0929.01/examples/line_io_client.py`. Python accepts `send_text(group_id, text, key, notify_user_id=user_id)`; explicit `None` disables @, and omission uses the default.
