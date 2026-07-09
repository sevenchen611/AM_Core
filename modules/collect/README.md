# modules/collect —（待抽出）訊息/照片落庫 + 群組路由 + AI 初判

> 狀態:**待做**。範本見 `modules/meetings/`。先讀 `modules/EXTRACTION_PLAN.md`。

## 這個模組做什麼
每則進來的 LINE 訊息的「進門」處理:查群組綁定(群→租戶/專案/角色/工種)→ 訊息落 Notion →
照片/檔案存 Drive+Notion 附件 → 對文字做 **AI 初判**(空間/工項/類型/信心度)→ 決定進佇列或自動歸檔。

## 來源(BuildAM `src/server.js`)
| 函式 | 行(約) | 說明 |
|---|---|---|
| `handleEvent` | 227 | 主流程:落庫 + 分流(**核心**,會呼叫下面所有) |
| `resolveGroupBinding` | 408 | 群組 → 租戶/專案/角色/工種/成員對照 |
| `resolveSenderName` | 451 | userId → 顯示名 |
| `storeAttachment` | 345 | 照片/檔案 → Notion 附件 + Drive |
| `mapMessageType` | 1303 | LINE type → 中文類型 |
| `resolveLineFilename` | 494 | 檔名推導 |
| **AI 初判**:`loadProjectContext` 507、`queryAllByProject` 519、`buildJudgePrompt` 544、`callAiJudge` 569、`extractJudgeJson` 607、`judgeMessage` 617 | | 見糾纏點 |

## 契約
```js
export default {
  name: 'collect',
  init(platform),                    // notionRequest / pushLineMessage / drive / AI 金鑰
  async onMessage(ctx),              // 落庫 + 分流;回傳 true=已處理(短路後續)
  // 音檔交給 meetings.onAudio;collect 只處理文字/照片/檔案
};
// ctx: { tenant, message, binding, text, senderName, groupId, event }
```
`ctx.tenant` 需帶:`dataSources { messages, attachments, groupBindings, spaces, workItems, projects }`、`driveRootFolderId`、AI 設定(provider/model/是否啟用)。

## ⚠️ 糾纏點
- **AI 初判是工程領域的**:`buildJudgePrompt` 讀「空間/工項/別名清單」來分類——這是 construction 知識。
  建議把 collect 設計成:通用落庫 + 一個 **classifier hook**;實際分類器由 `construction` 模組提供並註冊給 collect。
  這樣 collect 保持通用,森在等非工程租戶可換自己的分類器(或不分類)。
- **群組綁定 schema**:`resolveGroupBinding` 讀「群組角色/工種/成員對照」——工種是工程欄位。通用欄位(專案/角色/成員)留 collect,工程欄位由租戶 schema 決定。
- 與 `meetings` 的分工:server.js 目前先判 `hasPendingMeeting`→`consumeMeetingRoster`、再判 `isMeetingAudio`→音檔,最後才走 AI 初判。抽 collect 時,這個「音檔/會議答覆優先於初判」的順序要保留(由 core router 依序呼叫 meetings 再 collect)。

## BuildAM 綁定
vendored 複製 + 薄 shim;`server.js` 的 `handleEvent` 改為委派到 `collect.onMessage` + `meetings.onAudio`。
（注意:handleEvent 是 server.js 核心,改動較大——與動 server.js 的其他 session 協調。）
