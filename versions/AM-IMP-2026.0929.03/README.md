# OA group and member selector directory

Adds API 1.2.0 read-only discovery for selecting a LINE conversation container and an identifiable, currently verifiable member before an IO call.

- `GET /api/v1/line/directory/groups?after=<groupId>&limit=25`
- `GET /api/v1/line/directory/groups/{groupId}/members?after=<userId>&limit=25`

Both require `directory:read`. Follow `nextCursor` while `hasMore` is true; limit is 1–50. An ordinary scoped client sees only its authorized groups, revalidated against tenant assignment. An explicitly configured operator client with `directoryAllGroups:true`, an empty `groupIds` array, and **only** `directory:read` can inspect OA routing metadata across groups. It cannot read messages, push reports or change group assignments. Do not distribute operator credentials to unrelated applications.

Group discovery combines the existing tenant binding registries (including disabled bindings), configured IO group IDs, and all signed group webhook events after directory enablement. Each tenant binding source is read separately through its Notion ownership guard. Only group/member IDs, names and observation timestamps are stored in the deployment-owned `line_directory` schema; no conversations, reply tokens, tasks or reports are copied into the catalog or AMCore files.

`groups[].selectable` requires a successful live LINE group summary. Stale known groups remain visible with `presence:unknown` and a warning. `io.inputEnabled` / `outputEnabled` describe current configured transport subscriptions plus binding status as of the binding scan. `canReadInput` / `canSend` describe the calling key's permissions; actual IO calls still revalidate tenant binding. Directory visibility does not grant IO authority.

`users[].active:true` means that member's LINE group profile was successfully retrieved at `checkedAt`. It means neither online nor recently speaking. `activeUserIds` includes active IDs on the **current page**. `lastSeenAt` is the last observed message/postback, or null if no interaction is known. Member leave events exclude users in the fallback catalog; newer join/message events restore their observed membership. A failed profile lookup produces unknown membership, never an active member. Sending still verifies membership again.

## Coverage and LINE limitations

LINE has no endpoint listing every group containing an OA. Consequently group `coverage.complete` is always false; unseen historical groups require a new signed group event, for example a human message with the bot in the group. The binding scan's own completeness and time are separate fields.

Full member ID enumeration requires a verified or premium OA. A 403 falls back to IDs from binding member maps, IO configuration and webhook events; silent unknown members remain undiscoverable. Member `coverage.complete:false` and `reason:oa_member_enumeration_forbidden` explicitly report this. With provider enumeration available, all its pages must succeed before enumeration is marked complete; profile verification completeness is separate. `memberCount` supplies LINE's human-member count when available. Coverage is an observation, not a permanent membership guarantee.

References: [LINE user ID discovery](https://developers.line.biz/en/docs/messaging-api/getting-user-ids/), [group API reference](https://developers.line.biz/en/reference/messaging-api/#get-group-member-user-ids).

No endpoint sends notifications, creates tasks or performs approvals during discovery.
