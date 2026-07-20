# AM Platform 固定外部連線身分

AM Platform 對所有租戶使用同一組平台級外部連線；租戶不得在自己的 JSON、環境變數或程式碼中覆寫 Notion 或 Google Drive 身分。

| Service | Fixed identity | Credential source | Tenant isolation |
| --- | --- | --- | --- |
| Notion | `BuildAM` bot（葉綠宿總公司 workspace） | global `NOTION_TOKEN` | Each tenant supplies only its own parent page and data-source IDs. |
| Google Drive | `2014greenhotel@gmail.com` | global `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `GOOGLE_OAUTH_REFRESH_TOKEN` | Each tenant supplies only its own Drive root folder ID. |

Credentials remain only in the platform secret store / `.env`; never copy them into tenant JSON or an upgrade package.

## Pre-enable identity check

Run before enabling a tenant or replacing an OAuth refresh token:

```text
node --env-file=.env tools/verify-platform-connection-identities.mjs <tenant-drive-root-folder-id>
```

The check verifies the Notion bot is `BuildAM`, and that the active Google OAuth token can read and edit the given Drive root. It also checks whether the folder owner or an explicit permission is `2014greenhotel@gmail.com`.

The platform uses full Google Drive scope because tenants may supply existing folders that were not created through the AM OAuth application. This allows the fixed account to access its entire Drive. Tenant isolation is therefore enforced by AM Platform: each tenant receives one declared Drive root, and modules must write only below that root. The editable Drive-root check remains mandatory before tenant enablement.
