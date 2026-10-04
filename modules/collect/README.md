# collect — 訊息落庫(通用核心)

> 狀態:**已抽出**(BuildAM `src/server.js` 的「訊息落庫」段)。形狀比照 `modules/meetings/`。

把每則 LINE 事件**落進當前租戶的 Notion 庫**:訊息進「訊息」庫，照片/檔案/影片進「附件」庫。
這是所有租戶的第一道收集層——**只收、不判**。AI 初判、確認佇列、會議整理都由後續模組接手。

來源:BuildAM `src/server.js` 的 `handleEvent` + `storeAttachment`「訊息落庫」段,行為等同,重塑成模組形狀。
(群組綁定查詢已上移到 `core/router.js`;發送者解析在 `core/line.js`——collect 直接吃 `ctx.binding` / `ctx.senderName`。)

## 做什麼

1. **群組脈絡** — 讀 `ctx.binding`(路由器已解析):群組綁定頁、專案、是否總管群(`ctx.isMaster`)。
2. **發送者解析** — 讀 `ctx.senderName`(dispatcher 已用 `platform.resolveSenderName` 解過)。
3. **成員對照** — 名字 → LINE `userId`,新對照即時 PATCH 回綁定頁的「成員對照」欄(供日後推播真 @mention);
   已記過零成本。狀態以 **(租戶, 群組)** 為鍵(`memberSync` Map),跨租戶不污染。
4. **訊息落庫** — 寫入 `ctx.tenant.dataSources.messages`,`掛載狀態=未掛載`;有綁定則掛「群組綁定」,
   非總管群且有專案則掛「專案」。
5. **附件** — 所有啟用 collect 的租戶預設將群組／room 的 `image`/`file`/`video` 原檔存入自己的 Drive。LINE webhook 回應前先在附件庫留下持久保存工作；成功須驗證 Drive 歸屬、目錄和大小。保存失敗會留下狀態與重試，重啟後繼續處理。Notion 預覽是選用功能，大檔或不支援格式不會因此失去原檔。詳見 `AM-IMP-2026.1004.04`。
   Drive `未歸檔/YYYY-MM-DD/`。**會議錄音跳過**(由 `meetings` 自存 Drive,避免大檔重複下載+上傳)。

## 不做什麼

- **不做 AI 判斷**(那是 `triage` 的通用初判管線;空間/工項的領域分類詞彙又另在 `construction.classify`,
  屬工程領域知識,不應綁進通用落庫)。collect 只負責把訊息/照片落庫並交棒。
- 不做系統回聲自動歸檔、不進確認佇列、不整理會議。

## 介面

```js
init(platform)          // 注入共用能力:notionRequest / uploadFileToNotion / downloadLineContent /
                        //   resolveLineFilename / ensureDriveFolder / uploadToDrive
async onMessage(ctx)    // 每則訊息落庫;寫完「回傳 false」→ 不短路,後續模組續跑同一則事件
// ctx: { tenant, binding, groupId, isMaster, senderName, event, message, text, notionRequest }
```

- **寫哪個庫由 `ctx.tenant.dataSources` 決定**: `messages` 保存訊息，`attachments` 保存群組附件的持久工作與索引。啟用 collect 的群組附件必須具備附件庫、保存狀態 schema 和租戶 Drive 根目錄，缺少時不得成功回應收件。
- 落好的訊息列 id 掛在 `ctx.messagePageId`,供後續模組(triage/queue)承接同一列。
- Notion 寫入走 `ctx.notionRequest`(tenant-locked,per-tenant 隔離守衛):結構上碰不到別租戶的庫。
- Drive 目標資料夾用 `ctx.tenant.driveRootFolderId`,是否啟用看 `ctx.tenant.driveConfigured`。

## 與後續模組的分工(順序)

`tenants/*.json` 的 `modules` 順序 = 呼叫順序,collect 排第一:
先由 collect 把**每則訊息**(含會議錄音、會議答覆)落庫並回 false;接著 meetings 才 `onAudio` 收音檔、
或 `onMessage` 收斂會議答覆(回 true 短路)。這與 BuildAM「先落庫、再判會議/初判」的順序一致。

## 與 BuildAM 的行為對照

| 項目 | 行為 |
|---|---|
| 訊息庫欄位 | 訊息/內容/LINE 群組 ID/LINE 訊息 ID/發送者/時間/訊息類型/掛載狀態(未掛載)/群組綁定/專案 |
| 訊息類型 | `text→文字 image→照片 file→檔案 video→影片 audio→音訊 sticker→貼圖`,其餘→`其他` |
| 總管群 | 訊息不自動掛專案(留待佇列人工選) |
| 附件 Drive | 預設只存照片；租戶開啟強制政策後，群組內照片、檔案與影片全數存 `未歸檔/日期`，會議音訊存 `會議錄音/日期` |
| 會議錄音 | 不進附件流程 |
