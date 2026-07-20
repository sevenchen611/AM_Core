# Rollback — AM-IMP-2026.0718.01

Rollback 的目標是停止新架構影響使用者，不刪除來源證據或稽核歷史。

## 快速停用

```text
AM_MEMORY_QUERY_MODE=legacy
AM_MEMORY_MODE=off
AM_MEMORY_NOTION_PROJECTION=0
AM_MEMORY_VECTOR_SEARCH=0
AM_MEMORY_KNOWLEDGE_PROMOTION=review-only
```

重新部署目標 AM 後，既有 LINE/Notion 流程恢復為唯一對外路徑。不要更動其他 AM 的設定。

## 保留資料

- 保留 raw messages、events、task history、decisions、judgment traces 與 answer logs，供稽核和後續修正。
- 停止 queue consumer 前先讓目前 lease 到期或標記可重試。
- projection outbox 可暫停，不要直接清空。
- 若錯誤 event 已影響 current state，追加 correction event；不要刪除歷史 row。

## Database schema

本版本 schema 使用獨立 `am_memory` schema。若完成停用觀察且確認不再需要，可由資料庫 owner 在已驗證的 project-local backup 後另行封存或移除。套件不提供自動 DROP script，避免誤刪 production evidence。

## Notion projection

停用 projector 後，projection 頁面可標記為 archived 或 read-only。不要批次刪除，直到 PostgreSQL 對照、備份與 project owner 核准都完成。

## 回復條件

修正後重新從 `shadow` 開始，重跑套件驗證、tenant isolation 測試與至少一個完整 daily convergence 週期，再考慮回到 `structured-first` 或 `enforce`。
