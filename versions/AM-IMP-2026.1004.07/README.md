# AM-IMP-2026.1004.07: Retrieve archived LINE attachments

An active conversation can ask for a preserved original by replying to its LINE
message with `請提供這個檔案給我` or `請幫我找這個檔案`. AM checks the exact
quoted message ID in that tenant's attachment index and returns a Google Drive
link after current tenant-root, binary size and MD5 verification.

Use `請幫我找「完整檔名.pdf」` when older indexes have no exact LINE identity.
The filename must match exactly and identify one file in this conversation.
Historical group context may identify the conversation, but a preceding text
message is never treated as a quoted file message. Unknown or ambiguous sources
ask for clarification; missing originals ask for re-upload.

Group, room, private attachments and configured transport groups share the
service. Group requests cannot retrieve private or other-group attachments;
private requests retrieve only that sender's private originals. Shadow, inactive,
ambiguous and re-bound conversations cannot receive links. Existing Drive sharing
permissions remain in force; recipients need an already authorized Google account.

These commands preserve source evidence as general conversation, bypass task
extraction and reserve transport replies for AMCore. Normal discussion is unchanged.
All enabled Platform tenants use their existing own data source and Drive root.
Generic files cannot be sent as outbound LINE bot file bubbles, so this version
uses links for every binary type without downloading large originals.

References: [LINE quote webhooks](https://developers.line.biz/en/docs/messaging-api/receiving-messages/#receiving-quote-messages),
[outbound message types](https://developers.line.biz/en/docs/messaging-api/message-types/).
