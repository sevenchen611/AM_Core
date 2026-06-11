# Implementation Log - SevenAM Reference

Date: 2026-06-10

This log records the SevenAM implementation actions that produced AM-IMP-2026.0610.05. It intentionally avoids live LINE message bodies, secrets, tokens, and project-private database contents.

## User Decision

The project owner decided that LINE task judgement must stop using the raw LINE message record database because message records are fragmented and lack enough surrounding context.

Final rule:

- Do not read `MessageDataSourceID` for LINE task judgement.
- Read `ConversationDataSourceID` for LINE task judgement.
- Keep writing message records as raw event logs and outgoing message logs.
- Use a group member index table for Group ID / Room ID to User ID lookup.

## Database And Environment Work

Created or configured a project-local LINE group member index data source.

The index stores durable group membership relationships:

- group or room identifier,
- user identifier,
- display names when available,
- status,
- source,
- related conversation master page,
- last seen or sync time.

Configured the project runtime with a member-index env var.

The raw LINE message source env var remains configured only because webhook logging, outgoing logging, attachments, resend tracing, and debugging still need it.

## Hourly LINE Task Judgement

Updated the hourly LINE task judgement script:

- source changed from message records to conversation master pages,
- default judgement context changed to the latest 20 conversation messages,
- conversation-derived message ids are used for processing,
- task updates are reconciled against active total-control tasks before new task creation,
- message-level judged flag is no longer used as the judgement state,
- conversation master fields are used for judgement tracking.

Conversation-level fields:

- `最後任務判斷時間`
- `最後任務判斷訊息時間`
- `任務判斷狀態`

## Webhook Runtime

Kept dual writing:

- conversation master content,
- raw message log.

Removed the old message-level judged property from new incoming and outgoing message records.

Added non-blocking group or room member-index upsert:

- when a webhook source is group or room,
- and a source user id is present,
- the runtime records or updates that member in the project-local member index.

Failure to write the member index is logged as a warning and must not block normal LINE storage.

## User UI

Updated User UI generation:

- conversation-led mode is the default,
- message-log source is not configured as the LINE evidence source,
- conversation master page content is parsed into displayable LINE messages,
- task evidence prioritizes conversation master content,
- data counts label conversation-derived LINE messages,
- archived tasks are excluded from task surfaces by the prior related package.

Regenerated project-local User UI files after the source change.

## Daily Report Preview

Updated the 08:00 daily report preview generator:

- report clues are read from conversation master pages,
- raw message records are not queried as report clues,
- assistant operation and report-control messages are filtered out as non-task clues,
- generated preview succeeded from conversation-master data.

## Group Options And Owner Narrowing

Updated group option and responsibility owner narrowing scripts:

- group options continue to read conversation master pages,
- group member options read the new member index table,
- neither script reads the raw message log to infer members.

Added a setup script for the member index table.

Added a sync script that can attempt LINE member-list API population when available. In the SevenAM reference run, the LINE account returned that member-list access was unavailable, so webhook accumulation became the practical source.

## Documentation

Updated project docs and onboarding documents:

- conversation master is task judgement, User UI evidence, and report clue source,
- message log is raw/outgoing/attachment/debug only,
- group member index is the member lookup source,
- new project onboarding must create the group member index table.

Updated historical upgrade notes where they could otherwise imply message-record judgement.

## Package And Scheduled Commands

Updated project package commands:

- added a conversation-led judgement command,
- kept a compatibility alias for older command names,
- added member-index setup and sync commands,
- adjusted hourly command flow so member index and group options sync before judgement-related flows.

Updated Render configuration:

- judgement cron uses the conversation-led judgement command,
- judgement cron does not receive the message-log data source as judgement input,
- web service receives the member-index env var,
- web service still receives the raw message-log env var for allowed write/audit uses.

## Verification Performed

Syntax checks passed for the changed runtime and scripts:

- server runtime,
- control API,
- hourly LINE judgement,
- User UI generator,
- 08:00 daily report preview generator,
- group option sync,
- group member index sync,
- responsibility owner narrowing setup.

Dry-run checks:

- hourly judgement dry-run reported the source as the conversation data source,
- hourly judgement dry-run used conversation-derived source message ids,
- hourly judgement dry-run used a 20-message context limit,
- group option dry-run scanned conversation master pages,
- daily report preview generation succeeded and counted conversation clues.

Source scan result:

- remaining message-log references are allowed write/audit/debug paths,
- no remaining task judgement, report clue, or group member source path should read the message log.

## Known Follow-up

This package fixes the data-source problem. It does not fully solve judgement-quality calibration.

During dry-run, some low-value life chatter could still appear as candidate updates. That is a judgement-rule issue and should be handled by a separate calibration package or project-local rule update.

