# Install

Install independently into each target project or AM Platform tenant. Do not
copy tasks, keyword options, group bindings, LINE IDs, or secrets between
projects.

## 1. Deploy shared runtime code

Install the shared changes that provide:

- `core/line.js` multi-message replies;
- group and direct-chat postback dispatch in `server.js` and `core/modules.js`;
- `modules/task-control/`.

Enable `task-control` only in the target tenant's module list. For the first
installation, HOZO AM 2.0 uses the tenant key `hozo-am-2-0` and prefix `HZ2`.

## 2. Apply the target's additive Notion schema

From the target AM Platform runtime with only its own `.env` loaded:

```text
node --env-file=.env tools/apply-line-task-control-schema.mjs --tenant=hozo-am-2-0 --dry-run
node --env-file=.env tools/apply-line-task-control-schema.mjs --tenant=hozo-am-2-0 --apply
```

The script reads the target's `<PREFIX>_TASKS_DATA_SOURCE_ID`, adds only fields
that do not exist, and does not modify task rows. Stop on a field type mismatch
and resolve it project-locally.

## 3. Use the feature

In an active bound LINE group, send:

```text
今天待辦
本週待辦
已完成待辦
搜尋待辦 招募
```

Use the returned cards to complete normal tasks or to record progress, blockers,
next steps, and keywords. In the bound one-to-one assistant, the Rich Menu
commands `我的今天` and `我的行事曆` return the same interactive cards. Direct
task actions are owner-locked and limited to the user's active group scope;
unassigned personal tasks still require an exact owner match.

## 4. Project record

After local checks pass, update the target manifest and create a tenant-local
upgrade record. Use `Installed` only after the target's runtime code and schema
are applied and locally verified. Mark `Deployed` only after an active LINE
group canary and production logs verify the behavior.
