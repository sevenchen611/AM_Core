# Rollback

1. 將 AM Platform 回滾到本版本前的正式 commit 並重新部署。
2. 不刪除 `am_claims` 群組、成員、表單發布、選擇 session、queue、outbox 或 audit 資料。
3. 回滾期間暫停 canary 群組的請款單選擇功能，避免舊版錯誤投遞再次發生。
4. 保留 group scope 與 recipient binding 正式設定；不要用另一群組的投遞參照覆蓋它。
