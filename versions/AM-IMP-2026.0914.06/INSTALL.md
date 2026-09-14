# Install

此套件需對每個啟用工程模組的 AM Platform 租戶分開安裝；不可共用 Notion 資料庫或 Drive 根目錄。

1. 部署下列共用程式：

```text
modules/construction/drawings.js
modules/construction/dashboard.js
modules/construction/index.js
tools/provision-design-drawings.mjs
```

2. 在該專案自己的 AM Platform 環境中建立租戶專屬的 Notion 索引庫：

```text
node --env-file=.env tools/provision-design-drawings.mjs <tenant-key>
```

3. 將指令輸出的設定加入該部署環境的 secret settings：

```text
<PREFIX>_DESIGN_DRAWINGS_DATA_SOURCE_ID=<new-data-source-id>
```

4. 確認該租戶既有的 `<PREFIX>_DRIVE_ROOT_FOLDER_ID` 正確，且平台共用 Google OAuth 帳號可在根目錄新增檔案。

5. 重新啟動 AM Platform。不要把實際資料源 ID、Drive ID 或 OAuth 值寫入本套件或租戶 JSON。
