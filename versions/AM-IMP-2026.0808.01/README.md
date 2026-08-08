# Unified private assistant tasks

This package changes the HOZO AM 2.0 one-to-one LINE assistant from a
Rental-Calendar-backed personal task flow to a unified AM task flow.

The cutover is intentionally zero-migration:

- existing Rental Calendar personal task rows are not migrated;
- no dual-write window is required;
- the personal assistant stops using Rental Portal Calendar binding as a
  prerequisite for private tasks;
- AM tasks become the write target for private todos, meeting todos and
  operational todos.

The Rich Menu labels continue to send text commands, but their behavior now
lands in `modules/personal-assistant`:

| Rich Menu label | New behavior |
| --- | --- |
| 我的今日 | Lists the user's open AM tasks due today |
| 我的行事曆 | Lists the user's open AM tasks for the current week |
| 新增待辦 | Shows create guidance, or parses a multi-task create request |
| 昨日未完成 | Lists the user's open AM tasks due yesterday |
| 我要請款 | Still delegates to the claims module |
| 身份設定 | Shows AM private-assistant identity status |

LLM parsing uses `platform.llmForTenant(ctx.tenant)` with the cheap profile. For
HOZO AM 2.0, `tenants/hozo-am-2-0.json` pins the MiniMax backend model to
`MiniMax-M3`; the API key remains in `.env`.

