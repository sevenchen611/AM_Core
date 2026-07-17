# 工程 AM → AM Platform 切換手冊

## 結論

工程功能、租戶設定與後台都以 AM Platform 為唯一來源。既有 Notion 資料原地沿用，不匯出、不複製；正式切換只改 Render 環境、網域與 LINE webhook。

舊工程服務在觀察期內只作回退，不再接收新功能。觀察期通過後停用，最後刪除。

## 1. 環境變數搬移（只在 Render Secret UI 操作）

| 舊名稱 | AM Platform 名稱 |
|---|---|
| `BUILD_DATA_SOURCE_PARENT_PAGE_ID` | `ENG_NOTION_PARENT_PAGE_ID` |
| `BUILD_<NAME>_DATA_SOURCE_ID` | `ENG_<NAME>_DATA_SOURCE_ID` |
| `BUILD_DRIVE_ROOT_FOLDER_ID` | `ENG_DRIVE_ROOT_FOLDER_ID` |
| `BUILD_QUEUE_ACCESS_KEY` | `ENG_QUEUE_ACCESS_KEY`；排程共用值另填 `AMCORE_QUEUE_ACCESS_KEY` |
| `BUILD_PORTAL_PIN` | `ENG_PORTAL_PIN`；公開會議講者修正過渡期另填同值到 `AMCORE_PORTAL_PIN` |
| `BUILD_PUBLIC_BASE_URL` | `ENG_PUBLIC_BASE_URL`（工程網域）；平台預設另可填 `AMCORE_PUBLIC_BASE_URL` |
| `BUILD_AI_PROVIDER` | `ENG_AI_PROVIDER` |
| `BUILD_AI_JUDGE_MODEL` | `ENG_AI_JUDGE_MODEL` |
| `BUILD_MEETING_MODEL` | `ENG_MEETING_MODEL` |
| `BUILD_ESCALATION_DAYS` | `ENG_ESCALATION_DAYS` |
| `BUILD_REMINDER_HOUR` | `ENG_REMINDER_HOUR` |
| `BUILD_ESCALATION_OWNER` | `ENG_ESCALATION_OWNER` |
| `BUILD_CAL_ZS` / `BUILD_CAL_HZ` | `ENG_CAL_ZS` / `ENG_CAL_HZ` |

共用的 `LINE_*`、`NOTION_TOKEN`、`GOOGLE_OAUTH_*` 可沿用相同 secret value。AI 金鑰可維持全域，也可改用 `ENG_ANTHROPIC_API_KEY`、`ENG_ASSEMBLYAI_API_KEY`、`ENG_GEMINI_API_KEY`、`ENG_MINIMAX_API_KEY` 做工程租戶覆寫。

不得把任何 secret value 寫入本 repo、升級包、驗證報告或聊天內容。

## 2. 上線前閘門

1. `npm run dryrun:engineering`、核心隔離測試及所有工程模組 dryrun 通過。
2. 平台 `/health` 顯示：
   - `lineConfigured: true`
   - engineering 的 `notionConfigured`、`groupRoutingEnabled`、`driveConfigured` 為 true
   - engineering 的八個模組全在 `modulesLoaded`
   - `dataIsolationGuardEnabled: true`
3. 以兩個測試群驗證路由：工程群只落 engineering 資料來源；森在群只落 forest 資料來源。
4. 工程後台逐頁驗證：`/dashboard`、`/queue`、`/tickets`、`/budget`、`/contracts`。
5. 驗證既有 AM Portal 權限與 `buildam_auth` cookie 能進工程租戶，但不能進其他租戶。
6. 驗證 `/cron/reminders?tenant=engineering&key=...` 只巡工程資料。

## 3. 正式切換順序

1. 先部署 AM Platform 新版本，確認 `/health` 與後台，但暫不改 LINE webhook。
2. 將 `am.hozorental.com` 指向 AM Platform，確認首頁登入後導向 `/dashboard?tenant=engineering`。
3. 在 LINE Developers Console 將同一支 OA 的 webhook URL 改為：

   ```text
   https://<AM-PLATFORM-DOMAIN>/webhook/line
   ```

4. 按 Verify，確認 HTTP 200；此時只有平台會收到新事件。
5. 工程綁定群依序送：一般文字、照片、會議錄音、待辦／催辦測試，核對 Notion 與 LINE 回覆。
6. 觀察平台 log 至少一個完整工作日；舊工程服務保持可回退，但不再有 webhook 流量。

LINE Channel 同一時間只能有一個 webhook。不得用廣播、雙寫或兩個服務同時處理同一事件來驗證，否則會重複落庫與重複推播。

## 4. 路由對照

| 舊入口 | 平台入口 |
|---|---|
| `/`、`/auth` | 同路徑，改為 tenant-aware 平台登入 |
| `/dashboard` | `/dashboard?tenant=engineering` |
| `/queue` | `/queue?tenant=engineering` |
| 舊佇列內「回饋單／變更單」分頁 | `/tickets?tenant=engineering` |
| `/budget` | `/budget?tenant=engineering` |
| `/contracts` | `/contracts?tenant=engineering` |
| `/cron/reminders` | 同路徑，可加 `tenant=engineering` |
| `/m/<signed-id>` | 同路徑 |

舊 `/queue/api/tickets`、`change-orders`、`create-co`、`ticket-action` 在觀察期由 307 相容轉到 `/tickets/api/*`。

## 5. 回退

若平台出現漏訊、錯租戶、重複落庫、簽章錯誤或工程功能缺失：

1. 立即把 LINE webhook 指回舊服務的 `/webhook/line`。
2. 若工程網域也受影響，再把 `am.hozorental.com` 指回舊服務。
3. 保留平台 log 與出錯 message id，修正後重新走全部上線前閘門。
4. 不回滾 Notion 資料來源 ID；兩邊原本就指向同一份工程資料，僅需檢查是否有切換期間的重複紀錄。

## 6. 最終退役

觀察期通過並經負責人確認後：

1. 停用舊 Render service（先 suspend，不立即 delete）。
2. Portal 權限由 `am-buildam*` 改成 `am-engineering*`。
3. 移除 `tenants/engineering.json` 的舊 feature/project/cookie aliases。
4. 從 AMCore 的 active project registry 移除舊工程專案，保留一筆 deprecated 歷史紀錄。
5. 回退保留期結束後才刪除舊 Render service／repo；刪除前另行取得明確確認。
