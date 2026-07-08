# INSTALL — AM-IMP-2026.0708.02

安裝於既有 BuildAM(或未來工程型 AM)之上。前置:已裝 `AM-IMP-2026.0708.01`
(會議記錄資料庫、待辦任務資料庫、Drive 歸檔、pushLineMessage、群組綁定路由皆已存在)。

## 1. 取得 AssemblyAI API key

到 https://www.assemblyai.com/dashboard/api-keys 建立 key(開發者自建、自付費)。

## 2. 設定環境變數

**本機** `.env`(此檔含機密,不進 git、不進 AM_Core):

```
ASSEMBLYAI_API_KEY=<你的 key>
```

**生產(Render)**:後台 → 該 web service → Environment → 新增
`ASSEMBLYAI_API_KEY`(sync:false,值在 dashboard 填)。`render.yaml` 已宣告此變數。
> Render 不讀 `.env`;不設此變數 → 服務會安全退回舊 Gemini 直轉流程(不反問)。

Gemini 仍需保留(`GEMINI_API_KEY`):作為會議摘要收斂引擎,以及缺 AssemblyAI key 時的後備。

## 3. 部署程式

會議引擎全部落在兩個檔,無需資料庫 schema 變更、無需執行 script:

- `src/meeting.js` — 反問狀態機、AssemblyAI 轉寫、講者對齊、Gemini 收斂、
  落地發布;保留 `processMeetingRecording` 作為後備。匯出
  `isMeetingAudio` / `handleMeetingAudio` / `hasPendingMeeting` / `consumeMeetingRoster`。
- `src/server.js` —
  1. import 改為上述四個匯出;
  2. 文字訊息在 AI 初判前先檢查 `hasPendingMeeting(groupId)`,是則 `consumeMeetingRoster` 並 return;
  3. 音檔路由改呼叫 `handleMeetingAudio`,gate 條件含 `ASSEMBLYAI_API_KEY || GEMINI_API_KEY`;
  4. `initMeeting({...})` 注入 `assemblyKey: process.env.ASSEMBLYAI_API_KEY || ''`。

Git push 觸發 Render 自動部署。

## 4. 驗證

見 `VERIFY.md`。最小驗證:`node --check src/meeting.js src/server.js`;
`curl -H "Authorization: <key>" https://api.assemblyai.com/v2/transcript?limit=1` 應回 200。
