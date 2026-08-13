# Verify

## Shared package checks

```text
node --check core/line.js
node --check core/bootstrap.js
node --check core/modules.js
node --check server.js
node --check modules/task-control/index.js
node tools/dryrun-line-task-control.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0813.01
```

## Target-local schema checks

```text
node --env-file=.env tools/apply-line-task-control-schema.mjs --tenant=hozo-am-2-0 --dry-run
```

The dry run must show no pending fields after applying the schema. It must not
print a token, data-source ID, task title, or LINE identity.

## Required canary behavior before `Deployed`

1. In one active HOZO AM 2.0 group, send `今天待辦`; only tasks related to that
   group appear.
2. Tap a normal task checkbox; status changes to `完成`, a new audit event is
   appended, and a fresh completed card returns.
3. Tap the same old checkbox again; no second completion event is appended.
4. Open another task, add progress, a blocker, next step, and keywords; confirm
   each value and its LINE evidence appear only in that tenant's task.
5. Search using a task title word and a keyword; completed tasks remain
   discoverable.
6. Attempt a card action for another group's task; the server rejects it.
7. Use a task title that signals a sensitive external commitment; confirm the
   explicit completion confirmation is required.
8. In the bound one-to-one assistant, tap Rich Menu `我的今天` and
   `我的行事曆`; confirm each returns Flex task cards rather than a silent or
   text-only response.
9. Complete and update an owned task from the direct-chat card. Attempt a task
   owned by someone else or related only to a group outside the user's active
   bindings; confirm it is rejected.
10. Simulate a slow identity or task query; confirm the user receives an
    explicit retry message before the LINE reply token expires.

Run the AMCore alignment audit after the target manifest record is updated.
