# Verify — AM-IMP-2026.0718.01

## A. 套件靜態檢查

```text
node tools/check-upgrade-package.js AM-IMP-2026.0718.01
node versions/AM-IMP-2026.0718.01/scripts/verify-operational-memory-package.mjs
node versions/AM-IMP-2026.0718.01/scripts/dryrun-operational-memory-domain.mjs
node tools/audit-alignment.js
```

## B. Database checks

- PostgreSQL schema 可在乾淨 database transaction 中執行。
- 所有 operational-memory business tables 都有 `tenant_id`。
- 所有 tenant-owned tables 已啟用且強制 RLS。
- 不設定 `app.tenant_id` 時查詢 fail closed。
- tenant A 無法讀、更新、連結或搜尋 tenant B 的 row。
- duplicate external message 只產生一筆 raw message。
- confirmed event 沒有 source 時 promotion 失敗。
- confirmed task change 沒有 event/source 時寫入失敗。
- decision supersede 保留舊 decision 並只讓新 decision effective。

## C. Pipeline behavior

逐一執行 `fixtures/acceptance-cases.json`：

- 一般聊天與 assistant operation command 不建任務。
- 同 topic thread 的後續進度更新同一 canonical task。
- 「正常／已處理／已寄出」可成為既有 operational task 的完成證據。
- 會議 checkbox 直接成為 confirmed task candidate，並保留 meeting source。
- 低信心 project assignment 進待分類，不猜測。
- 新決策取代舊決策但不抹除歷史。
- 未核准聊天內容只能是 knowledge candidate。

## D. Query behavior

對 project progress、task/commitment、decision 各至少測試三題：

1. structured tables 是第一個 retrieval source。
2. raw message 只有需要細節或 evidence 時才取回。
3. 回答包含資料時間、目前狀態、尚待確認與可稽核 source。
4. 矛盾、低信心或無證據時明確回答未知/待確認。
5. `answer_logs` 可還原 query intent、retrieval scope、source ids、answer confidence 與 feedback。

## E. Resilience

- webhook response 不等待 extraction worker。
- 重跑 daily/weekly convergence 不產生重複 task 或 snapshot。
- worker retry 不重複套用同一 event effect。
- Notion projection 停用時，核心仍可 ingest、reconcile 與 query。
- 恢復 projection worker 後，outbox 可安全補送且冪等。

## F. Production gate

每個 AM 分開確認：

- 專屬 tenant UUID、database credentials、object prefix 與 connector secrets。
- AccessContext、RLS、retrieval filter 與 citation filter 四層一致。
- shadow comparison 經 owner 審查，錯誤分類與重複 task 在可接受範圍。
- 敏感項目仍需 owner confirmation。
- manifest 與 upgrade record 已更新。

未完成 production 驗證只能標記 `Installed`，不能標記 `Deployed`。
