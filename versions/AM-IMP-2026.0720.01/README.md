# AM-IMP-2026.0720.01 Meeting Todo Confirmation

This package adds a confirmation gate between meeting-record generation and formal task creation.

## Behavior

- Meeting audio still produces the meeting record first.
- Extracted todos are stored as candidate todos in a meeting review session.
- The LINE group receives a signed review link after the meeting record is posted.
- The host can choose:
  - skip confirmation and create tasks using the original flow;
  - open owner confirmation.
- During confirmation, every todo must have:
  - task title;
  - owner;
  - due date in `YYYY-MM-DD` format.
- Changing title, owner, or due date invalidates that todo's owner confirmation.
- After all todos are owner-confirmed, the host can finalize and create formal tasks.

## Scope

This is shared AM Platform logic in `modules/meetings/index.js`.

It does not add shared project data to AMCore. Live meeting records, task records, LINE group bindings, and member mappings remain project-local.

## Runtime Notes

The first implementation keeps review sessions in process memory. If the production service restarts while a review is pending, the already-created meeting record remains, but the pending review link is lost. A later hardening version should persist review sessions in a project-local data source.

For stronger LINE identity enforcement, set `config.meetings.liffId` in the project tenant config. Without LIFF identity, the signed review link still works, but host and owner checks cannot fully verify LINE user identity.
