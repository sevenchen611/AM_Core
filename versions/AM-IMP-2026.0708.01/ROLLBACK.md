# Rollback

- 程式:BuildAM repo 為線性提交,git revert 至目標 commit 後 push 即自動重新部署。
- 資料:Notion 資料庫與 Drive 檔案為累積資料,不隨程式回滾;
  錯誤單據以狀態(取消/一般對話)標記留痕,不硬刪。
- 提醒:停用 GitHub Actions workflow 即停止所有推播巡邏。
- Portal 整合:移除 rental 端 am-buildam* 授權鍵即斷開單一登入(金鑰網址仍可用)。
