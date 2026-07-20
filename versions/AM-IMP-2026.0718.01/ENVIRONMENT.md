# Environment — AM-IMP-2026.0718.01

只列變數名稱與用途；實際值必須留在各 AM 自己的 secret store。

## Required

```text
AM_MEMORY_DATABASE_URL
AM_MEMORY_TENANT_ID
AM_MEMORY_QUEUE_DRIVER
AM_MEMORY_OBJECT_STORE_DRIVER
```

## Feature switches

```text
AM_MEMORY_MODE=off|shadow|enforce
AM_MEMORY_QUERY_MODE=legacy|shadow|structured-first
AM_MEMORY_NOTION_PROJECTION=0|1
AM_MEMORY_VECTOR_SEARCH=0|1
AM_MEMORY_KNOWLEDGE_PROMOTION=review-only|enforce
```

預設首次安裝：

```text
AM_MEMORY_MODE=shadow
AM_MEMORY_QUERY_MODE=legacy
AM_MEMORY_NOTION_PROJECTION=0
AM_MEMORY_VECTOR_SEARCH=0
AM_MEMORY_KNOWLEDGE_PROMOTION=review-only
```

## Project-local connector values

依 driver 另行提供 LINE、Notion、queue、object storage 與模型 provider 需要的值。不得從另一個 AM 複製；不得由 AMCore 套件提供預設 secret。

## Runtime safety

- 每次取得 database connection 後，在 transaction 內設定 `SET LOCAL app.tenant_id = '<tenant uuid>'`。
- tenant id 必須來自已驗證的 server-side route/identity mapping，不接受 browser 或 LINE message body 任意傳入。
- background job 必須保存 tenant id 與 signed system principal；worker 不可使用全域 tenant fallback。
- 日誌不可輸出資料庫 URL、token、訊息全文、附件 signed URL 或 embedding。
