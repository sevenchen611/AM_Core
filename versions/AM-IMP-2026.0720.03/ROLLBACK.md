# Rollback

Rollback is project-local. Do not change another AM project's deployment,
records, credentials, or group bindings.

## Safe rollback

1. Stop new deployment of this version in the affected target.
2. Restore only the target-local router, dispatcher, meetings handler, and
   matching tests to the last verified revision.
3. Redeploy that target's own service.
4. Verify an enabled group still routes, existing audio/file meeting intake
   still works, and tenant isolation remains enforced.
5. Record the rollback in the target project's upgrade note and manifest. Do
   not leave the version marked `Deployed` after it has been reverted.

The two behaviors may be rolled back independently if necessary:

- Router rollback restores the prior binding-query implementation. Before doing
  so, confirm every affected Group Bindings data source already contains every
  select option referenced by that implementation; otherwise enabled groups may
  again appear unbound.
- Meeting-media rollback removes native `video` intake and its handled
  short-circuit while preserving the previous audio/file paths. Native LINE
  videos will no longer start meetings until the corrected version is restored.

Do not delete group bindings, messages, recordings, transcripts, meetings,
tasks, attachments, or audit evidence during rollback. This package has no
database migration or environment value to undo.
