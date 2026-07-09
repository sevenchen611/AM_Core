# modules/construction —（待抽出）工程領域（僅工程租戶啟用）

> 狀態:**待做**(最大、最糾纏,建議最後或拆多個 session)。範本見 `modules/meetings/`。

## 這個模組做什麼
工程租戶(BuildAM)專屬功能:**回饋單、變更單、工項/空間、工種、預算控制、發包合約、工程儀表板、
AI 初判的領域知識、回饋單到期/擱置提醒**。非工程租戶(森在等)不啟用此模組。

## 來源(跨多檔——可再拆成多個子 session)
| 子功能 | 來源檔 / 函式 |
|---|---|
| 回饋單(feedback ticket) | `src/queue.js`:`createTicket` 536、`generateTicketNumber` 511、`listTickets` 672、`ticketAction` 745、`linkMessageToTicket` 379、`appendHistory` 737;端點 `/queue/api/create-ticket`、`/tickets`、`/ticket-action` |
| 變更單(change order) | `src/queue.js`:`createChangeOrder` 875、`listChangeOrders` 708;端點 `/queue/api/change-orders`、`/create-co` |
| 預算控制 | `src/budget.js`(整檔)+ `scripts/setup-budget-schema.js`、`add-budget-unit-quantity.js` |
| 發包合約 | `src/contracts.js`(整檔;含自動回寫預算) |
| 工種清單 | `src/trades.js`(整檔) |
| 工程儀表板 | `src/dashboard.js`(整檔:專案卡/甘特/SOP/照片/未銷項/空間×工種矩陣) |
| AI 初判領域知識 | `src/server.js` 的 `buildJudgePrompt`/`loadProjectContext`(空間/工項清單)——由 construction 提供分類器給 `collect` |
| 到期/擱置提醒 | `src/server.js` 的 `runDueReminders` 684、`wakeParkedTickets` 805——由 construction 提供 pass 給 `reminders` |
| schema 種子 | `scripts/setup-notion-schema.js`、`seed-projects.js`、`seed-spaces.js` 等 |

## 契約
```js
export default {
  name: 'construction',
  init(platform),
  routes: [ /* /budget/*, /contracts/*, /dashboard/*, 及 queue 的回饋單/變更單端點 */ ],
  classify?(ctx),         // 供 collect 注入的 AI 初判分類器(空間/工項)
  reminderPasses?: [],    // 供 reminders 呼叫的工程到期/擱置 pass
  async tick?(ctx),
};
```
`ctx.tenant` 需帶工程專屬 `dataSources { feedbackTickets, changeOrders, workItems, spaces, budgets, contracts, projects, tasks, meetings }`、`queueAccessKey`、`calendars`、`am-buildam-budget/contract` 授權旗標。

## ⚠️ 糾纏點 / 切法建議
- **與 `queue` 共用 `queue.js`**:先與 queue session 講好,把回饋單/變更單整段圈出移來。
- **與 `collect` 的 AI 初判**:分類器移來,collect 只留 hook。
- **與 `reminders`**:到期/擱置 pass 移來。
- **與 `budget`/`contracts`**:這兩支已是獨立檔(前面的 session 做過),抽模組相對乾淨——**可當 construction 的第一步**(先搬 budget + contracts + trades + dashboard 這些「整檔」的,再處理散在 queue/server/collect 的糾纏部分)。
- 建議 construction 拆成 2–3 個 session:①budget+contracts+trades+dashboard(整檔、乾淨);②回饋單+變更單(切 queue.js);③AI 初判 + 到期提醒(切 server.js,與 collect/reminders 協調)。
