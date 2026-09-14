# Rollback

1. 將 Render production service 回復至前一個已驗證 deploy。
2. 本版無 schema 或資料遷移，不需回復資料庫。
3. 回復後使部署期間產生的短效 LIFF／selector 連結自然過期，請使用者重新由群組建立。
