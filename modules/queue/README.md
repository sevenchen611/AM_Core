# modules/queue — 確認佇列(通用部分)✅ 已完成

PM 用的「確認佇列」網頁與 API。從 BuildAM `src/queue.js` 抽出**通用佇列**;
**不含**開單/單據狀態邏輯(回饋單開立、變更單、核准/銷項/催辦 → 屬 `construction`)。

## 這個模組做什麼
- 待確認 / 已確認列表(`/queue/api/pending`、`/queue/api/confirmed`)
- 照片縮圖代理(`/queue/api/photo`,伺服器以自身 Drive 授權取縮圖)
- 掛載到空間/工項(`/queue/api/confirm`);佇列內**直接新增工項**(名稱+工種)
- **選專案掛載**(總管群訊息原本無專案,掛載時補上;`/queue/api/projects`、`/queue/api/options`)
- **雙向連帶掛載**:文字訊息上/下方相鄰的同群同人照片一併掛同一目標
- **批次確認**高信心(`/queue/api/batch-confirm`)
- **掛到既有回饋單**:LINE 回覆/複驗照片一鍵寫回單據(開立→回覆中),隨 `confirm` 帶 `ticketId`

## 介面(契約)
```js
export default {
  name: 'queue',
  init(platform),                               // 注入共用能力
  routes: [{ prefix: '/queue', handler }],      // /queue、/queue/api/*
};
```
- **共用能力**(`init(platform)`):`notionRequest`(帶 tenantKey 隔離)、`pushLineMessage`、
  Drive 助手(`getDriveAccessToken`/`ensureDriveFolder`/`driveConfigured`)、Portal(`portal`,由 route ctx 帶入)。
- **租戶特定**(每次由 `ctx.tenant`):`dataSources { messages, attachments, spaces, workItems, projects, feedbackTickets? }`、`driveRootFolderId`。
- **狀態隔離**:名稱快取以 page id(全域唯一)為鍵;館別代碼快取以**租戶**為鍵;所有查詢走 `tenant.dataSources` + `tenantKey` 隔離守衛。

## Web 授權(走 core Portal)
- `handler` 由 core 傳入 `portal`。授權 = `portal.pinAuthed(req)`(PIN cookie)或 `portal.userAuthed(req)`(hozo SSO)。
- 未授權:`GET /queue` 出 PIN 登入頁 → `POST /queue/api/login` 以 `portal.checkPin` 核對 → 種 `amcore_auth` cookie(值 = `portal.pinCookieValue()`)。
- **per-tenant**:頁面嵌 `TENANT`,所有 API 帶 `?tenant=`,server 依此解析租戶;`?scope=` 做子專案 scope 過濾。

## 與 construction 的接縫(不含開單)
- **掛到回饋單(mount)**屬本模組:掛上『既有』單據。
- **開立回饋單(create)**屬 construction:`POST /queue/api/create-ticket` 委派 `platform.createFeedbackTicket({ tenant, ...body })`;
  未載入 construction **或**此租戶未啟用工程 → 回 `501`(非工程租戶不服務開單)。✅ construction 已於 `init` 掛上 `platform.createFeedbackTicket`。
- **工種清單**:`GET /queue/api/trades` 委派 `platform.listTrades({ tenant })`(注意傳 ctx 物件,非裸 tenant);✅ construction 已於 `init` 掛上,非工程租戶容錯回 `[]`,前端可自由輸入新工種。
- `/queue/api/options` 的回饋單清單、`loadOptions` 的 tickets:僅當 `tenant.dataSources.feedbackTickets` 存在才查(非工程租戶自動略過)。
- 回饋單/變更單「單據管理」分頁、`ticketAction`/`createChangeOrder`/`listTickets`/`listChangeOrders`/開單編號 → **未搬入**(留給 construction)。

## BuildAM 綁定(不動生產)
vendored 複製 + 薄 shim:`BuildAM/src/_platform/queue/` 放一份本模組,shim 把舊 `deps`
(單一 `buildam` 租戶 + drive/portal)拆成 `platform` + 固定 tenant,`handleQueueRequest` 函式名照舊 re-export;
`server.js` 對外介面不變。（本次僅完成平台側模組,BuildAM 端綁定待接。)

## 驗證
- `node --check modules/queue/index.js` ✅
- 等同性煙霧測試(mock platform,不打真 API):授權閘、`listMessages` 查詢形狀、`confirm` 掛載+新增工項+隔離 tenantKey、
  非工程租戶不查回饋單、create-ticket 501/委派 —— 20/20 通過。
