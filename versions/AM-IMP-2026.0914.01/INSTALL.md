# Install

1. 將本套件程式碼合併至 AM Platform。
2. 啟動時依序執行既有 claims authority schema 與 `config/claims-group-form-routing.sql`。
3. 確認 `HZ2_CLAIMS_LIFF_ID`、Claims Authority、Finance Claims V3 bridge 與群組入口既有設定有效。
4. 部署後從財務後台進入「請款功能管理」→「請款單管理」。
5. 在任一請款單按「設定適用群組」，只勾選 canary 群組並按「正式發布」。

不需新增秘密值，也不需先建立草稿。

