# Verify AM-IMP-2026.0610.05

Run these checks inside the target project.

## Static Checks

Check changed runtime and script files for syntax errors.

Required targets usually include:

```text
src/server.js
src/control-api.js
scripts/sync-line-message-judgements.js
scripts/build-user-ui-connected-preview.js
scripts/generate-0800-daily-report-preview.js
scripts/sync-line-group-options.js
scripts/sync-line-group-member-index.js
scripts/setup-responsibility-owner-narrowing.js
```

## Source Scan

Search changed judgement/report/group scripts for message-log source usage.

Expected result:

- No hourly judgement query against `MessageDataSourceID`.
- No daily report clue query against `MessageDataSourceID`.
- No group member derivation from `MessageDataSourceID`.
- Remaining message-log references are only raw log, outgoing log, attachment audit, resend tracing, or debugging.

## Dry-run Checks

Run the hourly judgement dry-run with a small limit.

Expected output:

- `sourceDataSource` or equivalent shows `ConversationDataSourceID`.
- source message ids are conversation-derived.
- context limit is 20 unless explicitly overridden.
- no task or report writes occur in dry-run.

Run group option dry-run.

Expected output:

- conversations are scanned from the conversation master.
- member options are created or updated from the member index.
- no message-log member source is used.

Generate the daily report preview.

Expected output:

- report generation succeeds.
- important conversation clues come from conversation master content.

## User UI Checks

Regenerate User UI.

Expected output:

- generated User UI shows conversation-led LINE evidence.
- message-log data source is not configured as the LINE evidence source.
- task evidence links or renders conversation-master content.

## Production Checks

After Render deployment:

- webhook still stores conversation master and raw message log records,
- group or room user activity upserts the group member index,
- hourly task judgement uses conversation master source,
- scheduled group option sync can run without reading message records,
- generated User UI reflects updated Notion data after regeneration.

