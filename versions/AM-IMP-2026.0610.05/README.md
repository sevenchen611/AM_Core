# AM-IMP-2026.0610.05 - Conversation-master task intake source rule

This package records the shared migration rule used in SevenAM on 2026-06-10:

LINE task judgement must be led by the LINE conversation master, not by the raw LINE message log.

The raw message log is still useful and should still be written. Its role is audit, outgoing message logging, attachment linkage, webhook resend tracing, and debugging. It must not be the source used to decide whether a LINE conversation creates, updates, blocks, or completes a total-control task.

## Core Rule

- Do not read `MessageDataSourceID` as task-judgement input.
- Read `ConversationDataSourceID` for LINE task judgement, User UI evidence, and daily report conversation clues.
- Judge task creation and task updates from conversation-level context.
- Use the latest 20 messages from the same conversation master page as the default task-judgement context.
- Replace message-level judgement flags with conversation-level judgement state.
- Keep `MessageDataSourceID` only for raw event log, outgoing log, attachment audit, resend tracing, and debugging.

## Group Member Rule

Do not derive LINE group members from the raw message log.

Create a project-local LINE group member index table that stores:

- Group ID or Room ID.
- User ID.
- Group or room display name.
- Member display name when available.
- Member status.
- Last seen time.
- Related conversation master page.

The webhook should upsert member-index rows whenever a group or room member speaks. If the LINE account can call the member-list API, a batch sync may also populate the table. If the API is unavailable, keep unknown members unknown instead of falling back to the raw message log.

## Project-local Installation

Install this package separately in every AM-style project. Do not copy SevenAM data into another project.

Use each target project's own Notion data source IDs, Render service, environment variables, docs, and generated User UI files.

## SevenAM Reference

SevenAM was the first implementation reference for this package. The detailed implementation log is in:

```text
versions/AM-IMP-2026.0610.05/IMPLEMENTATION_LOG.md
```

That log describes the exact action classes and verification results without storing live project data or secrets.

