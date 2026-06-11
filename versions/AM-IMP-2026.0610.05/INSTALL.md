# Install AM-IMP-2026.0610.05

Apply this package inside one project at a time.

## 1. Confirm Project-local Sources

Identify the target project's equivalents of these values:

```text
PROJECT_CONVERSATIONS_DATA_SOURCE_ID
PROJECT_MESSAGES_DATA_SOURCE_ID
PROJECT_TASKS_DATA_SOURCE_ID
PROJECT_PROGRESS_REPORTS_DATA_SOURCE_ID
PROJECT_LINE_GROUPS_DATA_SOURCE_ID
PROJECT_LINE_GROUP_MEMBERS_DATA_SOURCE_ID
PROJECT_LINE_GROUP_MEMBER_INDEX_DATA_SOURCE_ID
```

Use project-specific env names such as `SEVEN_...` or `HOZO_...` when the runtime has not yet adopted generic names.

## 2. Update Source Policy

Update project docs, onboarding docs, and runtime comments:

- Conversation master is the LINE source for task judgement, User UI evidence, and report conversation clues.
- Message log is raw/outgoing/attachment/debug only.
- Group member lookup uses the member index table, not the message log.

## 3. Update Hourly LINE Task Judgement

Change the hourly judgement script so it:

1. Requires the conversation master data source.
2. Does not require or query the raw message log for judgement input.
3. Reads recent message content from conversation master page blocks.
4. Uses 20 recent messages as the default context limit.
5. Searches active project-local tasks before creating new tasks.
6. Updates conversation-level judgement fields instead of message-level judged flags.

Recommended conversation master fields:

```text
最後任務判斷時間
最後任務判斷訊息時間
任務判斷狀態
```

## 4. Keep Raw Message Writing

Do not remove webhook raw message logging unless the target project has another audit log.

Allowed message-log uses:

- Incoming LINE raw event log.
- Outgoing LINE message log.
- Attachment and media audit relation.
- Webhook resend tracing.
- Debugging.

Forbidden message-log uses:

- Task judgement source.
- User UI task evidence source.
- Daily report conversation clue source.
- Group member source.

## 5. Add LINE Group Member Index

Create a project-local database for durable group membership lookup.

Minimum fields:

```text
成員索引名稱
對象類型
GroupID
RoomID
群組顯示名稱
UserID
成員顯示名稱
圖片URL
成員狀態
來源
對話主檔
群組選項
最後同步時間
最後出現時間
同步訊息
```

Add its env var to the target project and Render service.

## 6. Update Webhook Member Capture

When a webhook event has:

- source type `group` or `room`, and
- source user id,

upsert the member index row for that group or room plus user.

This must be non-blocking. Failure to write the member index should not prevent normal LINE message storage.

## 7. Update Group Options And Owner Narrowing

Update group option and owner narrowing scripts so:

- group options read conversation master pages,
- member options read the group member index,
- neither script queries the raw message log for members.

## 8. Update User UI And Reports

Update User UI and report preview generation:

- User UI reads LINE evidence from conversation master content.
- User UI does not configure the message log as its LINE evidence source.
- 08:00 daily report preview reads conversation clues from conversation master content.

## 9. Verify Locally

Run syntax checks and dry-runs before production deployment.

## 10. Deploy Per Project

Deploy the target project's own Render service. Do not mark the package as deployed for a project until production webhook, scheduled jobs, and generated User UI have been checked.

