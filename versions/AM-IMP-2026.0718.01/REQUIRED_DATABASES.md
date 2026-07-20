# Required Databases — AM-IMP-2026.0718.01

## PostgreSQL

正式運作需要 PostgreSQL 15 以上版本。`pgcrypto` 用於 UUID；需要語意搜尋時再啟用 `vector` extension。

安裝 `schemas/postgresql-operational-memory.sql` 會建立以下 logical domains：

- tenancy and people
- groups and memberships
- raw messages and attachments
- processing jobs and judgment traces
- projects, project goals, project membership, entities, and aliases
- events and evidence links
- tasks, task-event links, and task history
- decisions and decision evidence
- knowledge candidates and approved knowledge
- project snapshots and daily summaries
- access grants
- answer logs and answer sources
- projection outbox

每個 AM Platform tenant 必須有不同 UUID。standalone AM 即使使用獨立資料庫，也必須保留 `tenant_id`，讓同一套程式與測試可安全重用。

## Object storage

附件本體應存放於 S3-compatible 或等價的 private object storage。每個 object key 必須以 tenant id 作 prefix；資料庫只保存 object key、hash、media type、size 與 extraction state。不得把永久公開 URL 寫入來源資料。

## Notion projections

Notion projection 是選用的人員介面。開啟時，每個 AM 使用自己 workspace 中的資料庫，並依 `notion-schemas/operational-memory-projections.json` 建立或對應：

- 專案總控
- 任務總控
- 決策紀錄
- 事件覆核
- 公司知識

Notion database IDs 只存在該 AM 的環境與 project-local 設定，不得放入 AMCore。

## Queue

Queue 可使用既有 AM Platform queue、PostgreSQL job queue 或受管理 queue。無論 driver 為何，都必須支援：

- idempotency key
- retry with backoff
- lease/visibility timeout
- dead-letter or failed state
- tenant id in every job envelope
- trace id from source through reconciliation
