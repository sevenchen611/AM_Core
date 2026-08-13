# AM-IMP-2026.0813.01 — Interactive LINE task control

Tenant: `hozo-am-2-0`
Status: Installed

## Intended outcome

From an active HOZO AM 2.0 LINE group or the bound one-to-one assistant, users
can request today's, this week's, completed, or searched tasks. A task card supports checkbox-style completion,
opening detail, and recording progress, blockers, next steps, and keywords.
Completed tasks remain searchable together with their audit evidence.

## Installed shared artifacts

- Shared multi-message LINE reply and postback dispatch support.
- Shared `task-control` module, enabled only for the `hozo-am-2-0` tenant.
- Additive schema installer and deterministic dry-run test.
- Package documentation and tenant-scoped action/evidence contract.

The module requires all five task-control fields before it accepts a command or
postback. It therefore fails closed and does not expose partial task updates.

## Installation verification

On 2026-08-13, the HOZO AM 2.0 secure runtime environment was supplied outside
AMCore. The installer confirmed `NOTION_TOKEN`, `HZ2_TASKS_DATA_SOURCE_ID`, and
the shared LINE credentials were configured without printing their values.

The tenant-local schema dry run reported all five required fields already
present and no pending changes. The idempotent apply and a second dry run both
completed successfully with no row updates. Shared syntax checks, task-control
dry run, package completeness check, and alignment audit passed.

No task, LINE message, group binding, Notion ID, environment value, or secret
was copied into AMCore.

## Production canary status

The first production runtime deployment loaded `task-control`, but the
2026-08-13 one-to-one Rich Menu canary exposed two gaps: direct commands were
still consumed by the text-only personal assistant, and direct task postbacks
were not dispatched. The repair delegates `我的今天` / `我的行事曆` to
`task-control`, adds owner-and-group-scoped direct postbacks, and adds explicit
timeouts so a slow identity or task query cannot remain silent.

Keep the status `Installed` until the repaired production deployment passes
the direct-chat and group canaries in `VERIFY.md`.

The schema can be rechecked safely from the secure runtime environment with:

```text
node --env-file=.env tools/apply-line-task-control-schema.mjs --tenant=hozo-am-2-0 --dry-run
```
