# modules/reminders —（待抽出）到期/逾期/行程提醒（通用骨架）

> 狀態:**待做**。範本見 `modules/meetings/`。先讀 `modules/EXTRACTION_PLAN.md`。

## 這個模組做什麼
週期性巡邏(由 `/cron/reminders` 每 15 分呼叫):待辦到期/逾期提醒、帶時刻待辦的行程前提醒、
逾期升級。**通用排程骨架**歸這裡;領域專屬的到期規則(回饋單)由 `construction` 提供。

## 來源(BuildAM `src/server.js`)
| 函式 | 行(約) | 歸屬 |
|---|---|---|
| `runAllReminderPasses` | 1065 | **骨架**(串起所有 pass)→ reminders |
| `runTaskDailyPass` | 975 | 通用待辦每日提醒 → reminders |
| `runTaskEveningPass` | 1028 | 行程前一晚提醒 → reminders |
| `runTaskTickPass` | 1045 | 行程前 30 分提醒 → reminders |
| `pushTaskReminder` 960 / `markTaskReminded` 946 / `taskReminderRecord` 956 / `taskGroupInfo` 905 / `openTasks` 932 | | 與 `tasks` 模組共用(見糾纏) |
| `runDueReminders` | 684 | **工程專屬**(回饋單到期/逾期/升級)→ construction |
| `wakeParkedTickets` | 805 | **工程專屬**(擱置回饋單復活)→ construction |

觸發端點:`src/server.js` 的 `/cron/reminders`(188 附近)→ 委派 `reminders.tick(ctx)`。

## 契約
```js
export default {
  name: 'reminders',
  init(platform),
  async tick(ctx),        // 跑一輪所有提醒 pass;由 core 的 /cron 端點依租戶呼叫
};
// ctx: { tenant }  → tenant.dataSources { tasks, feedbackTickets, projects, groupBindings }, escalationDays, ownerLineId…
```
設計:`tick` 跑通用 pass;領域 pass(回饋單到期/擱置復活)由 construction 註冊「額外 pass」給 reminders,或由 construction 自己的 tick 處理。**兩個 session 要講好這個介面**。

## ⚠️ 糾纏點
- `runDueReminders`/`wakeParkedTickets` 深度依賴「回饋單」schema(影響等級/擱置/觸發工項)——純工程,應歸 `construction`。
- task 提醒的讀寫與 `tasks` 模組重疊——抽出後改呼叫 `tasks.listOpen/markReminded`。
- 提醒推播要真 @mention 負責人(用 `pushLineMessage` 的 mention),這是平台底座能力。
