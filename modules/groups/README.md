# modules/groups — 群組治理後臺

所有租戶共用的 LINE 群組設定頁。它不是 Forest 專用模組，也不參與 LINE 訊息判斷；群組解析仍由 `core/router.js` 唯一負責。

## 路由

- `GET /admin?tenant=<key>`：租戶專案後臺首頁。
- `GET /groups?tenant=<key>`：群組對照表與編輯頁。
- `GET /groups/api/list?tenant=<key>`：同一份資料的 JSON。
- `POST /groups/api/update?tenant=<key>`：更新一筆群組綁定。

所有路由都要求該租戶的 PIN cookie 或 Portal SSO 權限。`tenant` 不是信任來源；每次 Notion 查詢與更新都帶 `tenantKey`，而既有頁面更新還會核對它的 data source 所屬租戶。

## 群組綁定 v2 欄位

保留既有路由必要欄位：`群組名稱`、`LINE 群組 ID`、`狀態`、`群組角色`、`成員對照`，並新增：

| 欄位 | 類型 | 用途 |
| --- | --- | --- |
| `群組用途` | rich text | 此群的工作範圍與上下文。 |
| `主要負責人` | rich text | 對此群承擔主要回覆／追蹤責任的人；後臺必須從該 LINE 群成員下拉選擇。 |
| `啟用功能` | multi-select | 訊息收集、待辦、會議、案件狀態、照片、提醒。 |
| `所屬目標` | rich text | 跨產業通用的專案／目標名稱；工程既有 `專案` relation 保留。 |
| `狀態更新權限` | select | 所有成員、主要負責人或總管。 |
| `預設提醒對象` | rich text | 催辦／升級時的預設對象；後臺可從該 LINE 群成員多選。 |
| `最後設定時間` | date | 最近一次後臺設定時間。 |
| `最後設定者` | rich text | PIN 或 Portal 操作者的辨識文字。 |

儲存後會使該 LINE 群的 Core 路由快取失效，下一則訊息立即使用新設定。

## 模組契約

此模組只使用 `init(platform)`、`routes`。它依賴 `platform.notionRequest`、`platform.portal` 與 `platform.router.invalidate(groupId)`；不提供 `onMessage`，不會改變既有功能模組的訊息處理順序。
