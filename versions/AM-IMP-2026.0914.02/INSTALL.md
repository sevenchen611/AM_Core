# Install

1. 從最新 `AM_Core` `origin/main` 建立乾淨分支。
2. 套用此版本的 AM Platform runtime 變更。
3. 對仍使用直接 V3 queue 入口的群組，確認既有 `HZ2_FINANCE_CLAIMS_V3_RECIPIENT_BINDINGS_JSON` 與 `HZ2_FINANCE_CLAIMS_V3_GROUP_ENTRY_SCOPES_JSON` 中有唯一且相互對應的 group binding 與 source scope。已發布表單選擇功能的群組以 LINE 事件原始群組回覆，不要求新增靜態投遞對照。
4. 不得將 LINE ID、token、資料庫秘密或真實請款資料寫入 repository。
5. 執行 `npm run dryrun:claims-authority`、Finance V3 direct/postgres checks 與 package check。
6. 經 PR 合併到 GitHub `main` 後，才部署 AM Platform Render 正式服務。
7. 部署後確認健康狀態、正式 commit，以及 custom domain 的 LIFF 路由。
