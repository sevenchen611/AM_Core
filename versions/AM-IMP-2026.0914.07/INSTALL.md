# Install

1. 在 Rental/Finance 套用 `0079_finance_claim_personal_templates.sql` 的冪等 runtime schema。
2. 發布 Rental/Finance 的私人範本 API 與 V3 Web 介面。
3. 確認 Rental 正式環境後，再發布 AM Platform 的 legacy LIFF 範本代理與身分橋接。
4. 保留既有 `AM_CLAIMS_API_TOKEN` 與 Finance V3 bridge 設定，不新增或複製 secret。
5. 只從兩個專案各自已合併的 `main` 透過正式部署管道發布。
