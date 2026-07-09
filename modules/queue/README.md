# modules/queue —（待抽出）確認佇列（通用部分）

> 狀態:**待做**。範本見 `modules/meetings/`。先讀 `modules/EXTRACTION_PLAN.md`。

## 這個模組做什麼
PM 用的「確認佇列」網頁與 API:待確認訊息列表、照片縮圖、掛載到空間/工項、佇列內新增工項、
批次確認。確認瞬間把訊息掛上目標、照片搬進 Drive 正式目錄。

## 來源(BuildAM `src/queue.js`)——**只搬「通用佇列」的部分**
| 函式 | 行(約) | 說明 |
|---|---|---|
| `handleQueueRequest` | 70 | 路由(挑出通用端點,見下) |
| `listMessages` | 137 | 待確認/已確認列表 |
| `loadOptions` | 230 | 某專案的空間/工項/回饋單選項 |
| `confirmMessage` | 274 | 確認掛載(核心) |
| `linkMessageToTicket` | 379 | 掛到回饋單（→ 見糾纏:回饋單屬 construction） |
| `archiveAttachments` | 434 | 確認後照片搬 Drive 四層目錄 |
| `moveDriveFile` | 484 | Drive 搬檔 |
| `batchConfirm` | 904 | 批次確認 |
| `servePhoto` 202 / `attachmentPhotos` 183 | | 照片代理/相鄰照片 |
| `renderQueuePage` | 935 | 佇列 HTML(混了工程料,見糾纏) |

**通用端點**(歸 queue):`/queue`、`/queue/api/pending`、`/queue/api/confirmed`、`/queue/api/options`、
`/queue/api/confirm`、`/queue/api/batch-confirm`、`/queue/api/photo`、`/queue/api/projects`、`/queue/api/trades`。

## 契約
```js
export default {
  name: 'queue',
  init(platform),
  routes: [ /* /queue, /queue/api/* 的通用端點 */ ],   // 見 meetings 尚無 routes;此模組以 routes 為主
};
// route handler 需能從請求解析出 ctx.tenant(哪個租戶的佇列),並做租戶內 scope 過濾。
```
`ctx.tenant` 需帶:`dataSources { messages, attachments, spaces, workItems, projects }`、`queueAccessKey`(網頁 key)、`driveRootFolderId`、`calendars`。

## ⚠️ 糾纏點(與 construction 共用 `queue.js`)
`queue.js` **混了工程領域**功能,這些**不歸 queue、歸 `construction`**:
- 回饋單:`createTicket` 536、`generateTicketNumber` 511、`nextTicketNumber` 505、`listTickets` 672、`ticketAction` 745、`appendHistory` 737;端點 `/queue/api/create-ticket`、`/queue/api/tickets`、`/queue/api/ticket-action`。
- 變更單:`createChangeOrder` 875、`listChangeOrders` 708;端點 `/queue/api/change-orders`、`/queue/api/create-co`。
- `confirmMessage`/`renderQueuePage` 內也夾雜「掛到回饋單」「開回饋單」的 UI/邏輯——需與 construction session 一起切乾淨。

**協作建議**:queue 與 construction 兩個 session 一起切 `queue.js`——先把「回饋單/變更單」整段圈出移到 construction,留下的就是通用 queue。或由一個 session 先切、另一個接手。
