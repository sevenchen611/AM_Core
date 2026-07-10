# tenants/ — 租戶設定

租戶是**資料**，不是程式。每個檔＝一個業務單位：指定它自己的 Notion 頁＋啟用哪些模組＋用哪個 env 前綴取機密。

## 欄位

| 欄位 | 說明 |
|---|---|
| `key` | 程式用的唯一鍵（英文，勿改） |
| `displayName` | 顯示名（中文） |
| `envPrefix` | 平台 `.env` 以此前綴存該租戶機密（**不進 git**）：`<PREFIX>_NOTION_PARENT_PAGE_ID`、`<PREFIX>_*_DATA_SOURCE_ID`、（如有）`<PREFIX>_LINE_*` |
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

## ⚠️ engineering 的 `config.meetings` 有一份手抄拷貝活在 BuildAM

BuildAM 目前以 vendored 方式綁定 meetings 模組,它的 shim(`BuildAM/line-oa-webhook/src/meeting.js` 的 `TENANT` 物件)裡**手抄了一份 `engineering.json` 的 `config.meetings`**。這是刻意的過渡做法(平台 `core/` 尚未接管 BuildAM 的部署),但代價是:

> **改這裡的 `config.meetings`(加一個 keyterm、改一個 type…)不會自動傳到 BuildAM。**
> 必須通知 **S3.buildam-binding** 依「這個檔案」重抄一次(不是依 diff——diff 又會是第三份會漂移的拷貝)。

兜底不靠人記得:BuildAM 那邊有一條 meetings dryrun,用 shim 的 `TENANT` 跑一場 mock 會議、斷言 keyterms 含「矽酸鈣板」且類型走「工地檢討」白名單。**shim 的 config 一旦落後於這裡,BuildAM 的 dryrun 會紅**,而不是靜默變笨。這是這個隱性契約唯一的自動守衛,別讓它失效。

（AM_Core 這端對應的守衛是 `tools/dryrun-meetings.mjs`。）

## 機密放哪

Notion 頁 ID、資料來源 ID、LINE/AI 金鑰**一律放平台的 `.env`（gitignore），不寫進這些 json**，以維持 AM_Core 不含生產機密的規則。此處只存「結構」與非機密設定。**LINE user id（如 controller）算個資，放 `.env`。**

## 目前租戶

- **工程**（`engineering.json`）＝ 原 BuildAM（旅宿工程管理）
- **森在**（`forest.json`）＝ Notion「AI」頁
