# tenants/ — 租戶設定

租戶是**資料**，不是程式。每個檔＝一個業務單位：指定它自己的 Notion 頁＋啟用哪些模組＋用哪個 env 前綴取機密。

## 欄位

| 欄位 | 說明 |
|---|---|
| `key` | 程式用的唯一鍵（英文，勿改） |
| `displayName` | 顯示名（中文） |
| `envPrefix` | 平台 `.env` 以此前綴存該租戶機密（**不進 git**）：Notion、Drive、Portal、行事曆、AI；舊 `<PREFIX>_LINE_*` 可被載入盤點，但正式入口固定使用全域同一支 OA |
| `modules` | 啟用的模組清單 |
| `config` | **「行業味」設定**（非機密）：詞彙、報告時刻表、欄位映射…模組從 `ctx.tenant.config` 讀 |

## `config` — 讓模組保持通用的關鍵

最高原則是**程式通用、行業味進設定**。凡是「換一個租戶就會不一樣」的東西——案場清單、部門、專業術語、報告發送時刻、Notion 欄位名——都放這裡，**不准硬寫進模組**。硬寫進去，那個模組就只能給一個租戶用。

```jsonc
"config": {
  "vocabulary": { "sites": ["寓好草悟道", "寓見櫻桃"], "departments": ["房務", "工務"] },
  "reportSchedule": { "morning": "08:30", "followUp": ["10:00", "13:00", "17:00"], "evening": "20:30" },
  "fieldMap": { "任務名稱": "Name" }   // 只有欄位名與通用模組預期不同時才需要
}
```

## engineering 已由平台直接承接

`engineering.json` 是工程 AM 唯一的租戶設定來源。會議詞彙、模組順序、Portal 相容別名都由平台啟動時直接讀取，不再有另一份手抄 tenant 或 vendored 模組要同步。

`config.portal` 內的 `featureAliases`、`projectAliases`、`legacyPinCookies` 只服務切換期的舊帳號／cookie。Portal 權限完成改名並通過觀察期後即可移除。

## 機密放哪

Notion 頁 ID、資料來源 ID、LINE/AI 金鑰**一律放平台的 `.env`（gitignore），不寫進這些 json**。每租戶可用 `<PREFIX>_ANTHROPIC_API_KEY`、`<PREFIX>_ASSEMBLYAI_API_KEY`、`<PREFIX>_GEMINI_API_KEY`、`<PREFIX>_MINIMAX_API_KEY` 覆寫平台預設；模組透過 `ctx.tenant.ai`／`platform.llmForTenant()` 取得。**LINE user id（如 controller）算個資，也放 `.env`。**

## 目前租戶

- **工程 AM**（`engineering.json`）＝ AM Platform 的旅宿工程管理租戶
- **森在**（`forest.json`）＝ Notion「AI」頁；平台首頁為 `/admin?tenant=forest`，群組對照表為 `/groups?tenant=forest`
