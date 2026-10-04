# collect — 訊息落庫(通用核心)

> 狀態:**已抽出**(BuildAM `src/server.js` 的「訊息落庫」段)。形狀比照 `modules/meetings/`。

把每則 LINE 群組事件落進當前租戶的 Notion 訊息庫；所有附件原檔存入該租戶的 Google Drive，Notion 附件庫僅保存資訊、來源證據、保存狀態與 Drive 連結。
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
5. **附件** — 所有啟用中的租戶以持久服務保存 `image`/`file`/`video`/`audio`，涵蓋群組、room、唯一身分綁定的私人對話及經授權的 transport 綁定。保存不依檔案大小或副檔名排除；供應商限制及 Drive 可用容量仍適用。LINE webhook 回應前先留下持久保存工作；只有通過歸屬、目錄、大小及雜湊驗證才標記已保存。失敗保留狀態與重試，重啟後繼續處理。詳見 `AM-IMP-2026.1004.06`。
   群組原檔使用 Drive `未歸檔/YYYY-MM-DD/`；私人原檔使用 `私人附件/使用者識別雜湊/YYYY-MM-DD/`。會議錄音共用同一原檔，轉寫不另外存副本。Notion 不上傳附件預覽。舊 Notion 原檔須先核對 Drive 歸屬與獨立來源雜湊，成功後才清除檔案欄位；過期且無備份的來源標記需要重傳。

## 不做什麼

- **不做 AI 判斷**(那是 `triage` 的通用初判管線;空間/工項的領域分類詞彙又另在 `construction.classify`,
  屬工程領域知識,不應綁進通用落庫)。collect 只負責把訊息/照片落庫並交棒。
- 不做系統回聲自動歸檔、不進確認佇列、不整理會議。

## 介面

```js
init(platform)          // 注入共用能力:notionRequest / attachmentArchive / downloadFromDrive
async onMessage(ctx)    // 每則訊息落庫;寫完「回傳 false」→ 不短路,後續模組續跑同一則事件
async onDirectMessage(ctx) // 僅保存私人附件，回覆 Drive 連結或尚未保存的狀態
// ctx: { tenant, binding, groupId, isMaster, senderName, event, message, text, notionRequest }
```

- **寫哪個庫由 `ctx.tenant.dataSources` 決定**: `messages` 保存群組訊息，`attachments` 保存附件的持久工作與索引。所有啟用租戶的附件必須具備附件庫、保存狀態 schema 和租戶 Drive 根目錄，缺少時不得成功回應收件。私人附件不進群組任務判斷；跨租戶身分不明時拒絕猜測。
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
| 附件 Drive | 全部附件原檔保存於各租戶自己的 Drive；Notion 僅留資訊與連結 |
| 會議錄音 | 共用持久附件服務的原檔，會議分析不重複上傳 |
