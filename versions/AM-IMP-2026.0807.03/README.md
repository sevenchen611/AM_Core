# HOZO Rich Menu action binding

This package binds the current HOZO Rich Menu labels to the deployed private
assistant features by making the AM Platform runtime accept the exact button text
as LINE message commands.

The v1 behavior is intentionally text-action based:

| Rich Menu label | Message action text | Runtime behavior |
| --- | --- | --- |
| 我的今日 | `我的今日` | Today's personal calendar and AM projected work |
| 我的行事曆 | `我的行事曆` | Supported weekly calendar query |
| 新增待辦 | `新增待辦` | Guided create instructions; no write until user sends a dated item and confirms |
| 昨日未完成 | `昨日未完成` | Yesterday unfinished query |
| 我要請款 | `我要請款` | Signed claims LIFF entry through the claims module |
| 身份設定 | `身份設定` | Identity and binding status; notification settings remain unopened |

No LINE tokens, Rich Menu IDs, user IDs, claim records, calendar rows, or Notion
data are stored in this package.

