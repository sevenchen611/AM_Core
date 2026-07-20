# AM Platform（葉小蝸 AI 小幫手）

> 一支付費 LINE OA → 一個 webhook（`/webhook/line`）→ Core 依群組綁定解析租戶 → 模組處理 → 各租戶自己的 Notion 母頁。

`AM_Core` 就是平台原始碼與運行時。工程 AM 不再維護第二套功能程式；原工程服務只在正式切換完成前作短期回退，不接受新功能。

## 平台結構

| 層 | 位置 | 責任 |
|---|---|---|
| 平台入口 | `server.js` | `/health`、首頁登入、唯一 LINE webhook、模組 routes、排程 |
| Core | `core/` | 租戶載入、群組路由、Notion 隔離、LINE／Drive／Portal／LLM 接線 |
| Modules | `modules/` | 功能邏輯；一份程式服務多租戶，契約見 `modules/README.md` |
| Tenants | `tenants/` | 租戶身分、模組清單、非機密設定；機密由 `<PREFIX>_*` 環境變數載入 |

## 工程 AM 的平台定版

工程租戶鍵固定為 `engineering`，環境前綴固定為 `ENG`。處理順序為：

```text
collect → meetings → media → triage → queue → tasks → reminders → construction
```

- `meetings` 必須在 `triage` 前，確保錄音後的與會資訊答覆不會被誤判成一般訊息。
- `media` 與 `triage` 分別承接照片事件關聯與文字 AI 初判。
- `construction` 擁有工程儀表板、回饋單、變更單、預算、合約、工種與工程提醒規則。
- 原 Notion 頁與資料來源 ID 原地沿用；只把環境變數名稱改掛到 `ENG_*`，不複製資料。

## 唯一入口與資料隔離

1. LINE Developers Console 只能設定一個 webhook：AM Platform 的 `/webhook/line`。
2. 事件先用 `groupId` 查每個租戶自己的「群組綁定」資料來源；狀態必須為啟用。
3. 命中後建立 tenant-locked `ctx`。所有 Notion 請求必須帶 `tenantKey`。
4. Core 只放行該租戶宣告過、且實際位於該租戶母頁下的資料來源；跨租戶存取直接拒絕。
5. Portal 個人帳號先通過租戶 `amAccess`，再以群組綁定 Page ID 限縮群組設定、佇列、待辦與案件；任何 Notion 寫入仍需再通過第 4 點的租戶守衛。

## 固定外部連線

- 全平台 Notion 只使用 `BuildAM`（葉綠宿總公司 workspace）的全域 `NOTION_TOKEN`。
- 全平台 Google Drive 只使用 `2014greenhotel@gmail.com` 的全域 OAuth 授權；為使用租戶既有資料夾，授權範圍為完整 Drive，不得建立租戶個別 OAuth 身分。
- 每個租戶只提供自己的 Notion 母頁／資料源與 Drive 根目錄，不能覆寫上述身分。啟用前執行 `tools/verify-platform-connection-identities.mjs` 驗證。

## 個人帳號與群組授權

授權鏈固定為：`個人帳號 → 租戶 → 對話群組 → 功能操作 → 租戶 Notion 隔離守衛`。

- Portal `admin_users.am_access` 是群組權限唯一來源。`mode=all` 包含該租戶未來新增群組；`mode=selected` 只包含列出的群組綁定 Page ID。
- Core 的後臺 route 只接受 `public | machine | tenant | group` 四種授權宣告，未宣告即不掛載。
- `group` route 的清單、單筆、批次、附件與寫入都要逐筆核對 relation；直接竄改 `tenant`、`pageId`、附件 ID 或待辦 ID 不得繞過。
- Portal SSO cookie 只存 opaque session handle。Core 每次後臺請求向 Portal `/api/am-sso/verify` 讀最新帳號，因此停用或撤權下一次請求立即生效。
- 日常租戶 PIN 預設停用。緊急入口只有在 `AMCORE_ENABLE_EMERGENCY_PIN=1` 時可用，最長 15 分鐘且只代表緊急最高管理者。
- Webhook 與排程使用 `system principal`，不受個人群組清單限制，但永遠受 per-tenant Notion 守衛。

## 群組治理與後臺

- 每個租戶在自己的 Notion「群組綁定」資料表維護群組用途、主要負責人、啟用功能、所屬目標、案件狀態更新權限與提醒對象。
- 共用 `groups` 模組提供 `/admin?tenant=<key>` 與 `/groups?tenant=<key>`；這是同一套平台功能，不建立 Forest／HOZO／Seven 各自的後臺程式。
- Core 路由器將上述欄位放入 `ctx.binding`。模組可依功能設定採取行為，但不可自行跨租戶查群組表。
- 群組設定頁只能改該租戶自己的綁定頁；儲存後立即失效該群的快取，下一則 LINE 訊息套用新設定。

## 工程服務切換原則

- 平台功能與環境預檢完成前，不改 LINE webhook、不停舊 Render。
- 切換只改入口與網域指向，不搬 Notion 資料。
- 切換後保留舊服務作短期回退；觀察期通過再停用，最後才刪除舊服務與舊權限別名。
- 完整步驟見 `docs/ENGINEERING_PLATFORM_CUTOVER.md`。
