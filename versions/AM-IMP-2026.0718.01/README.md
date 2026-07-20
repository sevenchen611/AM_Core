# AM-IMP-2026.0718.01 — AM Operational Memory Foundation

Status: **Ready**

這個版本把 AM 從「LINE 對話保存器」升級成可持續維護公司運作狀態的共用核心。它將來源資料整理成四個可查詢層級：

```text
原始來源層 → 結構化事件層 → 專案當前狀態層 → 經核准知識層
```

第一階段的產品範圍刻意集中在三項能力：

1. 專案進度：目前狀態、最新進度、下一步、阻礙、風險與負責人。
2. 任務與承諾：誰答應什麼、何時完成、目前等誰、是否逾期。
3. 決策紀錄：決定內容、決策人、理由、影響、目前是否仍有效。

## 核心決策

- PostgreSQL 是可稽核的記憶核心與目前狀態來源。
- 物件儲存保存附件；資料庫只保存 metadata、摘要、雜湊與物件 key。
- `pgvector` 是可選的第二階段檢索能力，不是資料正確性的來源。
- Notion 是人員閱讀、確認與管理的投影，不是大量原始對話或事件歷史的唯一資料庫。
- 原始資料追加保存；目前狀態可更新，但每次改變都必須追加歷史與來源證據。
- 正式總控任務必須連到專案目標；任務本身確定但目標仍不清楚時，保留為 candidate 並列出待釐清內容。
- 一套 AM Platform 程式可服務多個 AM，但每一列資料、每個工作、每次搜尋與每則答案都必須鎖定 `tenant_id`。

## 套件內容

- `ARCHITECTURE.md`：服務邊界、寫入與查詢流程、真實來源分工。
- `MIGRATION.md`：從既有 Notion-first 流程逐 AM shadow、收斂與切換的方法。
- `schemas/postgresql-operational-memory.sql`：可移植的 PostgreSQL schema、來源證據 gate 與 RLS 基礎。
- `contracts/event-extraction.schema.json`：LLM 事件抽取固定輸出格式。
- `contracts/operational-memory-api.json`：服務間最小 API 契約。
- `config/operational-memory-contract.json`：事件、任務、決策與知識的共用詞彙。
- `config/reconciliation-policy.json`：對話分串、規則載入、去重、任務更新與收斂規則。
- `config/query-answer-policy.json`：結構化優先、原文補證據的分層查詢規則。
- `config/retention-policy.json`：熱、溫、冷資料與合法刪除例外。
- `notion-schemas/operational-memory-projections.json`：Notion 投影欄位契約。
- `templates/tenant-operational-memory.example.json`：每個 AM 的非機密設定範本。
- `fixtures/acceptance-cases.json`：可重跑的行為驗收案例。
- `scripts/plan-tenant-install.mjs`：只讀產生單一 AM 的安裝計畫。
- `scripts/verify-operational-memory-package.mjs`：驗證套件、契約與資料隔離規則。
- `reference/domain/operational-memory.mjs`：可重用的 tenant/evidence/idempotency/reconciliation 純領域核心。
- `scripts/dryrun-operational-memory-domain.mjs`：不連線、不寫 production data 的領域行為測試。

## 與現有 AMCore 的關係

這個版本不取代既有的 LINE 每小時任務 reconciliation、任務證據紀錄、任務階層、群組綁定與授權版本；它把這些能力放進同一個可持久化的 operational-memory 契約中。

## 資料邊界

本套件只包含共用程式、schema、契約、空白範本與合成測試案例。不得把任何 AM 的 LINE 訊息、Notion page id、附件、使用者、資料庫連線、token 或其他私密資料寫入 AMCore。

## 不在本版本直接完成的項目

- 不替任何正式 AM 建立或搬移 production 資料。
- 不自動部署 Render 或切換 production traffic。
- 不把未確認的聊天內容直接升格為正式公司知識。
- 不允許 LLM 直接越過 evidence gate 寫入 confirmed 狀態。

安裝與切換必須依 `INSTALL.md` 分租戶執行，並先以 shadow 模式比較現有 Notion 流程。
