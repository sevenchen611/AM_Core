# modules/tasks — 待辦任務(建立 / 展開 / 狀態 的共用讀寫)

> 狀態:**✅ 已完成**。範本見 `modules/meetings/`。

## 這個模組做什麼

「待辦任務」資料庫的**共用 CRUD**:建立待辦、一次展開多筆、改狀態、查未完成、記提醒。
目的是讓 `meetings`、`construction`(回饋單/單據)、`reminders` **共用同一套**,而非各寫各的
(原本散在 `meetings.publishMeeting` 內建待辦那段,與 BuildAM `src/server.js` 的
`openTasks`/`markTaskReminded`/`taskReminderRecord`)。

## 對外服務(meetings、construction 單據呼叫)

`init(platform)` 時把服務掛到共用的 `platform.tasks`,其它模組於自己 `init` 捕捉的**同一個
`platform`** 即可直呼(不必改 core、不必互相 import):

```js
await platform.tasks.createTask(ctx, {
  content, owner, due, source,        // 通用欄位
  projectPageId, meetingId, feedbackId, groupBindingId,  // 領域關聯(有給才寫)
});
await platform.tasks.expandTasks(ctx, todos, { source, projectPageId, meetingId });
await platform.tasks.setStatus(ctx, pageIdOrTask, '完成');
```

> 載入期全部模組先 `init` 完才會有訊息進來,故執行期 `platform.tasks` 必在。

## 契約

```js
export default {
  name: 'tasks',
  init(platform),                          // 注入共用能力 + 掛 platform.tasks 服務
  async createTask(ctx, task),             // 建一筆 → pageId
  async expandTasks(ctx, todos, common),   // 展開多筆(容錯,單筆失敗不中斷)→ pageId[]
  async setStatus(ctx, taskOrId, status),  // 狀態機 → 實際寫入的狀態名
  async listOpen(ctx),                     // 未完成且有期限(reminders 用)→ task[]
  async markReminded(ctx, task, key, val), // 記已發提醒
  reminderRecord(task),                    // 讀提醒記錄(純函式)
  lastTask(tenant, groupId),               // (租戶,群組) 最近建立的一筆(對話式改狀態錨點)
  routes,                                  // GET /tasks 唯讀待辦頁(portal 守衛)
};
```

`ctx.tenant` 需帶:`dataSources.tasks`(以及領域關聯所指的 `projects` / `meetings` / `feedbackTickets` 由呼叫端傳 id)。

## 欄位對應(Notion `tasks` 資料庫)

| 欄位 | 型別 | 來源 | 說明 |
|---|---|---|---|
| 內容 | title | `task.content` | 必填 |
| 負責人 | rich_text | `task.owner` | 有才寫 |
| 期限 | date | `task.due` | 純日期=整日;帶時刻(`YYYY-MM-DD HH:MM`)= **行程**,存台灣時區 `+08:00` |
| 來源 | select | `task.source` | **會議 / 回饋單 / 手動**(預設手動) |
| 狀態 | select | `task.status` | **待辦 / 進行中 / 完成 / 取消**(預設待辦) |
| 專案 | relation | `task.projectPageId` | 有才寫 |
| 會議記錄 | relation | `task.meetingId` | 有才寫(會議展開) |
| 回饋單 | relation | `task.feedbackId` | 有才寫(construction 單據) |
| 負責群組 | relation | `task.groupBindingId` | 有才寫(reminders 找回原群) |
| 提醒記錄 | rich_text(JSON) | `markReminded` | reminders 記哪些提醒已發 |

> **領域欄位邊界**:通用欄位(內容/負責人/期限/來源/狀態)恆存;領域關聯(專案/會議記錄/回饋單/負責群組)
> 由呼叫端以選填 id 帶入 —— **有給才送,沒給就不出現在 body**,故同一份模組可服務不同租戶的 tasks schema。

## 隔離 / 狀態鍵

- 寫 Notion 一律經 `platform.notionRequest`,目標庫 id 只取自 `ctx.tenant.dataSources.tasks`;服務被別模組
  直呼(只帶 `ctx.tenant`)時自動補 `tenantKey` 走**嚴格綁定**,守衛據此擋跨租戶。
- 模組內狀態(`lastTask`)一律以 **`(租戶, 群組)`** 為鍵(`${tenant.key}::${groupId}`),不跨租戶污染。

## 與 reminders 的邊界

tasks 只管「資料 CRUD」(建立/查詢/更新/提醒記錄);**「什麼時候提醒、推播文案」屬 `reminders`**。
`reminders` 呼叫 `listOpen` 取未完成待辦、用 `reminderRecord`/`markReminded` 記狀態。

## 後續服務收斂

抽出後,應回頭把既有「自己建待辦/查待辦」的地方改成呼叫本模組:
- `modules/meetings/`:`publishMeeting`/`processRecording` 內建待辦那段 → `platform.tasks.expandTasks(ctx, parsed.todos, { source:'會議', projectPageId, meetingId })`。
- `construction`(回饋單開待辦)→ `platform.tasks.createTask(ctx, { source:'回饋單', feedbackId })`。
- `reminders` 內由舊工程服務沿用的 `openTasks`/`markTaskReminded` 邏輯 → `listOpen`/`markReminded`。

> 這些改動屬各自模組的 session;本模組已提供等價介面,收斂時行為不變。

## 驗證

- `node --check modules/tasks/index.js` ✅
- `node tools/dryrun-tasks.mjs` ✅(8/8:屬性等同 meetings 待辦、行程期限、狀態機、展開容錯、服務掛載、(租戶,群組)鍵隔離、listOpen 過濾)
