# 安裝 LINE I/O API

此套件在 AMCore 為 Ready。應安裝在實際承接「葉小蝸」OA webhook 的專案部署中，不在 AMCore 儲存正式金鑰、群組 ID、訊息或資料庫。HOZO_AM／SevenAM 若需使用，分別配置與驗證，不能共用對方權限或匯入對方資料。

1. 將 `core/line-io/` 與 `server.js` 的 import、初始化、API 路由與 webhook capture 改動套入實際專案。部署 checkout 若較新，逐段合併，不整檔覆蓋。現有 `pg` 相依需由該專案 `npm ci` 安裝。
2. 在**部署環境自己的 PostgreSQL** 執行 `schemas/line-io.sql`。授予執行服務對這三張表與 sequence 的必要權限。初始化不會自動建表。若多租戶共用部署資料庫，程式每次查詢都限定 tenant；不得將此資料庫暴露給 API 呼叫端。設定資料庫備份與容量監控。
3. 在部署服務的 secret manager / 環境變數設定：

| 變數 | 值 |
| --- | --- |
| `AMCORE_LINE_IO_ENABLED` | `1`，預設不啟用 |
| `AMCORE_LINE_IO_DATABASE_URL` | 本部署 PostgreSQL connection string，依服務商設定 TLS |
| `AMCORE_LINE_IO_CLIENTS_JSON` | 以下 client 設定 JSON，實際 tenantKey 與群組 ID 只放部署環境 |
| `DAILY_REVIEW_LINE_API_KEY` | 安全隨機產生至少 32 字元的專用 key |
| `LINE_CHANNEL_ACCESS_TOKEN`、`LINE_CHANNEL_SECRET` | 沿用葉小蝸 OA 在此部署的設定 |

Client JSON 模板（群組 ID 為示意，安裝時替換）：

```json
[
  {
    "id": "daily-review",
    "tenantKey": "<專案既有 tenant key>",
    "tokenEnv": "DAILY_REVIEW_LINE_API_KEY",
    "groupIds": ["C00000000000000000000000000000000"],
    "inputUserIds": ["U00000000000000000000000000000000"],
    "notifyUserId": "U00000000000000000000000000000000",
    "transportOnly": true,
    "scopes": ["groups:read", "events:read", "messages:write"]
  }
]
```

每個外部程式使用不同 id、key。僅讀程式移除 `messages:write`。若同一程式需多租戶，各租戶建立不同 client/key。群組必須已有唯一、有效的專案群組綁定；只有 `啟用` 狀態允許發送。變更設定或撤銷 key 後重啟服務。

4. 服務使用 HTTPS；設定部署入口合理的 API rate limit。LINE Console 開啟 Use webhook、Webhook redelivery 與 Allow bot to join group chats，確認 OA 已在目標群。沿用本服務 `/webhook/line`，不需要新增 OA。可停用 OA Manager 自動回覆，以免和既有程式重複回應；依現行服務政策決定。
5. 在專案本地跑 VERIFY，再部署。先驗證 groups 與 events 讀取；實際 LINE 推播 canary 應由負責人選擇測試群與訊息後執行，僅向負責人指定的測試群執行。
6. 將 HTTPS base URL、此程式的 key、OpenAPI 與 Python 範例交給每日審批程式。審批程式持久化 cursor 與 webhookEventId 業務去重資訊，排程由它自己的環境管理。
7. 更新實際專案自己的 `docs/project-improvement-manifest.md` 與 `docs/upgrades/AM-IMP-2026.0929.01-line-io-api.md`：本地驗證後 Installed；正式服務實测通過後才 Deployed。未安裝專案保持 Ready，不寫成已部署。

資料庫可改設定 `AMCORE_LINE_IO_DATABASE_ENV` 指向本環境已有 URL 的變數名稱，`AMCORE_LINE_IO_DATABASE_SSL_ENV` 指向 SSL 變數名稱。SSL 為 false 時只適用提供商受信任內部網路；true/verify-full 使用憑證驗證。Schema 安裝可執行 `node tools/install-line-io-schema.mjs`。執行角色只應有三張 IO 表和 sequence 的必要權限，遷移應使用 schema owner。
