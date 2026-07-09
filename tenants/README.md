# tenants/ — 租戶設定

租戶是**資料**，不是程式。每個檔＝一個業務單位：指定它自己的 Notion 頁＋啟用哪些模組＋用哪個 env 前綴取機密。

## 欄位

| 欄位 | 說明 |
|---|---|
| `key` | 程式用的唯一鍵（英文，勿改） |
| `displayName` | 顯示名（中文） |
| `envPrefix` | 平台 `.env` 以此前綴存該租戶機密（**不進 git**）：`<PREFIX>_NOTION_PARENT_PAGE_ID`、`<PREFIX>_*_DATA_SOURCE_ID`、（如有）`<PREFIX>_LINE_*` |
| `modules` | 啟用的模組清單 |

## 機密放哪

Notion 頁 ID、資料來源 ID、LINE/AI 金鑰**一律放平台的 `.env`（gitignore），不寫進這些 json**，以維持 AM_Core 不含生產機密的規則。此處只存「結構」。

## 目前租戶

- **工程**（`engineering.json`）＝ 原 BuildAM（旅宿工程管理）
- **森在**（`senzai.json`）＝ Notion「AI」頁
