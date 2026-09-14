# Rollback

1. 以新的回退 PR 回復 AM Platform 的 legacy LIFF 範本按鈕與代理 action。
2. 以新的回退 PR 回復 Rental/Finance 的 V3 範本 UI 與 API route。
3. `finance_claim_personal_templates` 表可先保留，避免刪除使用者範本；停用程式後不再讀寫。
4. 若確定需要清除資料，另行取得明確授權並先匯出受影響範本，不在一般程式回復中刪表。
