# modules/tasks —（待抽出）待辦任務（共用 helper）

> 狀態:**待做**。範本見 `modules/meetings/`。先讀 `modules/EXTRACTION_PLAN.md`。

## 這個模組做什麼
「待辦任務」資料庫的**共用讀寫**:建立待辦、查詢未完成、更新狀態/提醒記錄。
目的是讓 `meetings`、`reminders`、`construction`(回饋單開待辦)**共用同一套**,而非各寫各的。

## 來源(目前散落,沒有獨立檔)
- **建立待辦**:`meetings` 模組的 `publishMeeting`/`processRecording` 內,對 `tenant.dataSources.tasks` 建頁那段(會議展開待辦)。抽出成 `tasks.create(ctx, { content, owner, due, source, projectPageId, meetingId })`。
- **查詢/更新**:BuildAM `src/server.js` 的 `openTasks` 932、`markTaskReminded` 946、`taskReminderRecord` 956、`taskGroupInfo` 905(reminders 在用)。
- 未來 `construction` 的回饋單也會開待辦 → 改呼叫 `tasks.create`。

## 契約
```js
export default {
  name: 'tasks',
  init(platform),
  async create(ctx, task),          // 建一筆待辦(回 pageId);ctx.tenant.dataSources.tasks
  async listOpen(ctx),              // 未完成待辦
  async markReminded(ctx, task, ...),
};
```
`ctx.tenant` 需帶:`dataSources { tasks, projects, meetings, feedbackTickets }`。

## ⚠️ 糾纏點
- 這是**先收斂再受惠**型:抽出後,要回頭把 `meetings`、`reminders`、`construction` 裡「自己建待辦/查待辦」的地方改成呼叫本模組。
- 待辦 schema 有工程味(關聯「回饋單」「會議記錄」)。通用欄位(內容/負責人/期限/狀態/來源)留 tasks;領域關聯欄位由租戶 schema 決定,`create` 以選填參數帶入。
- 與 `reminders` 邊界:tasks 只管「資料 CRUD」;「什麼時候提醒、推播文案」屬 `reminders`。
