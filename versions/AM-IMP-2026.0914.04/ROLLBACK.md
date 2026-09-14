# Rollback

1. 先回復 AM Platform 至前一個已驗證 deploy，版本歷史 API 資料不受影響。
2. 如需恢復第二張表單，重新將明確群組指派給它並正式發布。
3. Rental 程式可回復，但不要刪除 published v1 版本或已寫入請款的版本快照。
4. migration 建立的索引與歷史版本資料皆應保留；它們是稽核紀錄的一部分。
