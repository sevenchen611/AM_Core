# AM User UI 架構

`User UI` 是 AM 面向使用者的網頁介面模組。

它與 production LINE bot runtime 分開。AMCore 負責共用 UI 規格、模板、產生器、安裝套件與驗證規則。各子專案，例如 HOZO_AM 與 SevenAM，則各自擁有自己的 generated UI data、project-local configuration、Notion database IDs、LINE records、tasks、meetings 與 attachments。

2026-06-09 整合版 User UI 規則維護於：

```text
D:\Codex_project\AM_Core\docs\USER_UI_RULES_2026-06-09.md
```

共用任務詳情頁模板標準維護於：

```text
D:\Codex_project\AM_Core\docs\USER_UI_TASK_PAGE_TEMPLATE.md
```

## 目的

User UI 的目的，是讓使用者能用更快、更清楚的 HTML 入口查看原本存在 Notion 裡的資料。

第一階段 User UI 介面包含：

- 專案總覽。
- 所有專案與其支援任務。
- 所有任務紀錄。
- LINE 群組、近期訊息與附件。
- 會議記錄。
- 進度報告與每日報告。
- AM Core 判斷規則。
- 專案專屬判斷規則。
- 已遮蔽秘密資訊的 Environment data。
- 可用的 AMCore upgrade versions。
- Admin 使用者的開發設定。

任務清單是日常操作入口，不是完整歷史歸檔。狀態為 `封存`、`已封存` 或 `Archived` 的任務應留在專案本地 Notion 任務庫供稽核，但 User UI 產生器不得把這些任務帶入所有任務清單、專案任務清單或任務頁輸出。

## 任務來源證據與媒體

當任務頁顯示造成、更新或完成該任務的 LINE 對話證據時，必須保留有用的訊息脈絡與媒體。

User UI 只要引用 LINE 對話內容，就必須回查專案本地 `LINE 對話主檔` 或 `LINE 對話組檔`，並使用該主檔內文樣式呈現。

LINE 對話引用不得由任務頁、報告頁或搜尋頁各自重新設計樣式。所有引用都必須重用同一套 LINE conversation renderer。

LINE 對話引用呈現標準定義於：

```text
D:\Codex_project\AM_Core\docs\LINE_CONVERSATION_RENDERING_STANDARD.md
```

規則：

- 當 LINE 來源訊息含有圖片、照片、檔案、PDF、影片或其他附件時，任務證據卡不得只顯示文字。
- 在專案本地媒體檔或外部圖片 URL 可用時，User UI 必須把圖片與照片證據呈現為可點擊縮圖。
- 非圖片附件應呈現為檔案連結或附件紀錄連結。
- 媒體可以來自訊息紀錄本身，也可以來自專案本地附件資料庫，但必須留在專案本地。AMCore 不得複製 live media files 或 attachment records 到共用 repository。
- 如果媒體下載、Notion 上傳或本地預覽檔不可用，任務頁仍應顯示 media message placeholder、message id、來源 LINE 群組、發話者、時間，以及任何可用的附件紀錄連結。
- LINE 對話頁與任務證據卡應使用相同媒體呈現方式，讓使用者在任務頁內就能檢視原始視覺脈絡。

## 會議來源任務證據

會議記錄是 User UI 的第一級任務證據來源。

當任務來自會議 checkbox、meeting action item，或 `meeting:<meetingPageId>:<itemId>` 這類 sync id 時，任務頁必須先將來源分類為會議證據，不得先 fallback 到 LINE 對話。

必要行為：

- 來源區塊顯示 `資料來源：會議記錄`。
- 當會議 URL 可用時，關聯頁面必須連到來源會議記錄。
- 任務頁在可用時顯示會議名稱、會議日期與有用的會議內文摘要。
- checkbox 或 action item 文字必須以 `行動項目` 保留。
- source marker 與 sync id 必須保留供稽核。
- 會議衍生任務不得顯示 `來源對話群組：LINE 對話群組`。

LINE 對話來源呈現仍適用於 LINE 衍生任務。本規則只防止會議衍生任務被錯誤標示為 LINE 群組證據。

## 任務判斷規則頁

`任務判斷規則` 頁是使用者查看任務判斷邏輯的單一入口。

它應顯示：

- AMCore 共用規則。
- 專案專屬規則。
- 從專案本地校準案例整理出的學習規則。
- 從 User UI 手動新增的規則。

AMCore 的共用 prototype 包含 `手動加入任務判斷規則` 區塊，用來作為核心 User UI 設計來源。在子專案中，產生後的 User UI 會將手動規則送到 `/control/judgment-rules/create`，再由專案 runtime 寫入該專案自己的 judgment rules data source。

這些規則不是只供 User UI 顯示。每小時 LINE 任務判斷、任務更新、會議同步與報告寫回等判斷流程，都必須依下列標準載入最新規則後才進行判斷：

```text
D:\Codex_project\AM_Core\docs\TASK_JUDGMENT_RULE_LOADING_STANDARD.md
```

歷史校準案例可以留在專案本地 Notion database 中供稽核與訓練歷史使用，但若其有用內容已整理進規則頁，就不應再以獨立一級 User UI navigation item 呈現。

## 存取模型

User UI 必須區分 project users 與 Admin users。

- Project users 只能看自己的專案資料。
- Admin users 可以查看與設定所有專案。
- LINE tokens、Notion tokens、channel secrets、API keys、passwords 等秘密資訊預設必須遮蔽。
- 未來若要加入 reveal secret action，必須要求 Admin 權限並留下 audit logs。

## 資料邊界

AMCore 可以儲存：

- User UI templates。
- User UI generators。
- 共用 layout 與 schema specifications。
- 安裝與驗證說明。

AMCore 不得儲存：

- 專案 `.env` 值。
- Token 或 secret 值。
- Live LINE messages。
- Live task records。
- Live meeting records。
- Production Notion database IDs 作為 required shared values。

Connected previews 應產生在子專案資料夾內，不應產生在 AMCore。

## 目前檔案

- 共用 prototype：
  `D:\Codex_project\AM_Core\docs\AM_SUBPROJECT_PORTAL_PROTOTYPE.html`
- Connected preview generator：
  `D:\Codex_project\AM_Core\tools\build-user-ui-connected-preview.js`
- SevenAM generated preview：
  `D:\Codex_project\SevenAM\line-oa-webhook\docs\user-ui-connected-preview.html`

## 產生器

範例：

```text
node D:\Codex_project\AM_Core\tools\build-user-ui-connected-preview.js --project-root D:\Codex_project\SevenAM\line-oa-webhook --name SevenAM --output D:\Codex_project\SevenAM\line-oa-webhook\docs\user-ui-connected-preview.html
```

產生器會讀取專案本地 `.env`、查詢已設定的 Notion data sources、遮蔽 secrets，並在子專案內寫出靜態 HTML preview。
