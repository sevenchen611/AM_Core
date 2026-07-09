# modules/meetings — 會議記錄

綁定群組收到會議錄音,自動整理成 Notion 會議記錄並發回 LINE。

## 流程
1. 群組收到音檔 → 反問「與會者(含發言順序)/主題」(大檔先回「已收到」再處理)。
2. 使用者回覆與會資訊(或 30 分鐘逾時)→ **AssemblyAI 轉寫 + 講者分離**,依首次發言順序對齊真名。
3. **Gemini** 收斂成:重點摘要 / 主議題結論 / 分區逐條筆記 / checkbox 待辦 / 下次會議提醒(含當日日期換算)。
4. 建 Notion 會議頁(主頁 hub + 三個可展開區段 tab:📄 摘要、📝 筆記、🎧 逐字稿),待辦展開到待辦任務資料庫。
5. LINE 推「重點摘要 + 主議題結論 + 待辦」(不含逐字稿,過長自動分段)。

**韌性**:AssemblyAI 上傳/轉寫失敗會自動重試,再不行則自動改用 **Gemini 直讀音檔備援**(仍產出摘要+筆記+待辦,只是無署名逐字稿);完全無 AssemblyAI key 時也走 Gemini 直轉。

## 契約(預設匯出)
```js
export default {
  name: 'meetings',
  init(platform),                 // 注入共用能力
  isAudio(message),               // 此訊息是否為會議音檔
  rosterPrompt(filename),         // 反問與會者/主題的文字
  hasPending(tenant, groupId),    // 此(租戶,群)是否正在等與會資訊
  async onAudio(ctx),             // 綁定群收到音檔 → 暫存並反問
  async onMessage(ctx),           // 每則訊息;若在等與會資訊則收斂,回傳 true=已處理
  async consumeRoster(ctx),       // 直接以與會資訊收斂發布
  async processRecording(ctx),    // 無 AssemblyAI 時的 Gemini 直轉
};
```

### init(platform) — 共用能力(所有租戶相同)
`{ notionRequest, pushLineMessage, assemblyKey, geminiKey, geminiModel, ensureDriveFolder, uploadToDrive }`

### ctx — 每次呼叫(帶租戶脈絡)
- `tenant`:`{ key, dataSources: { meetings, tasks, projects }, driveConfigured, driveRootFolderId }`
- 音檔類:`{ tenant, buffer, filename, contentType, binding, senderName, groupId, ackSent }`
- 訊息類:`{ tenant, groupId, text, senderName }`

## 狀態隔離
會議「待補 pending」以 **`${tenant.key}::${groupId}`** 為鍵,不同租戶不互相污染(見 `pkey()`)。

## 現行使用者
- **BuildAM**(工程租戶):以 vendored 複製方式綁定(`BuildAM/line-oa-webhook/src/_platform/meetings/` + 薄 shim `src/meeting.js`),行為與抽模組前完全等同。
