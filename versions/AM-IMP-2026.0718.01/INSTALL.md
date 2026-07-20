# Install — AM-IMP-2026.0718.01

每個 AM 必須分開安裝與驗證。不要複製其他 AM 的 `.env`、LINE、Notion、資料庫、附件、帳號或 production records。

## 0. 前置條件

1. 讀取 AMCore `config/projects.json` 與本套件全部檔案。
2. 確認目標是 AM Platform tenant、HOZO_AM、SEVEN_AM 或新 AM。
3. 確認依賴版本已安裝或已有等價能力：LINE hourly reconciliation、task evidence log、task hierarchy、group binding v2、tenant-to-group authorization。
4. 讀取目標專案自己的 manifest；不要讀取另一專案的 secrets 或 production data。

## 1. 產生 project-local 安裝計畫

複製 `templates/tenant-operational-memory.example.json` 到目標專案的安全設定區，改成該專案自己的非機密值。執行：

```text
node versions/AM-IMP-2026.0718.01/scripts/plan-tenant-install.mjs --config <project-local-config.json> --out <project-local-plan.json>
```

計畫器只檢查設定完整度並列出步驟，不連線、不建立資料、不輸出 secrets。

## 2. 建立資料庫基礎

1. 對目標 AM 的 PostgreSQL 執行 `schemas/postgresql-operational-memory.sql`。
2. 建立該 AM 的 tenant row；tenant UUID 不得與其他 AM 共用。
3. 讓 runtime role 不是 schema owner，並確認 RLS/`FORCE ROW LEVEL SECURITY` 生效。
4. 以 transaction 設定正確的 `app.tenant_id` 後執行 read/write smoke test。
5. 使用另一個 tenant id 測試同一資料 id，必須讀不到也寫不到。

## 3. 接入 source adapters（shadow）

1. LINE webhook 在既有 raw record 成功後送出標準 source envelope；不得等待 AI。
2. 會議 checkbox、daily report、system suggestion 與 manual correction 使用相同 evidence envelope。
3. 每個 queue job 帶 tenant id、source id、trace id 與 idempotency key。
4. 啟用 `AM_MEMORY_MODE=shadow`；只寫 operational memory，不改既有對外回答與 Notion 任務。

## 4. 啟用 extraction 與 reconciliation（shadow）

1. LLM 僅能輸出 `contracts/event-extraction.schema.json` 格式。
2. 每次判斷前載入共用、project-local、learned 與 manual judgment rules。
3. candidate event 通過來源 gate 才能 confirmed。
4. 先比對既有 task/decision，再新增；所有更新都追加 history 與 rule trace。
5. 跑 `fixtures/acceptance-cases.json`，並用目標專案的脫敏案例做 parallel comparison。

## 5. 啟用 structured-first query

1. 先將 `AM_MEMORY_QUERY_MODE=shadow`，比較 legacy 與 structured answer。
2. 驗證 project status、task/commitment、decision 三類問題。
3. 驗證每個回答 source 都通過同一 AccessContext。
4. owner 核准後切換為 `structured-first`；不支援的意圖仍走既有流程。

## 6. 啟用 Notion projection（選用）

1. 在目標 AM 自己的 Notion 建立或 mapping projection databases。
2. projection worker 只讀 projection outbox，並使用該 AM 自己的 token/database IDs。
3. 人工改動必須回寫成 manual event，禁止直接覆蓋 PostgreSQL history。
4. 模擬 Notion 失效，確認核心仍可寫入與回答；恢復後 outbox 可補同步。

## 7. 完成紀錄

1. 執行套件 verifier 與 `VERIFY.md`。
2. 在目標專案建立 `docs/upgrades/AM-IMP-2026.0718.01-operational-memory-foundation.md`。
3. 更新目標專案 `docs/project-improvement-manifest.md` 為 `Installed`。
4. 只有正式 service 部署並完成 production tenant-isolation 驗證後，才能標記 `Deployed`。

本套件在 AMCore 的狀態維持 `Ready`；AMCore 本身不部署 production service。
