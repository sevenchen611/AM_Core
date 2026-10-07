# LINE 回覆取回照片與原檔

在原始照片／附件按「回覆」，實際 @葉小蝸 AI 小助手，說「請提供我這個檔案」或「請提供我這張照片」。

本版延伸正式平台既有 `AM-IMP-2026.1004.07` 查找流程，不替換 collect、全附件持久保存、中央歷史封存或傳輸群組路由。保留租戶、群組／私人來源、狀態、大小、MD5 與 Drive 範圍驗證，以及命令排除待辦和重送防重複處理。

- JPEG／PNG 原圖不超過 10 MB：重新貼到 LINE，預覽縮為最長邊 1024、至多 1 MB JPEG，另附原檔下載。
- PDF、Word、大圖、HEIC 等：提供原檔下載。一般檔案不使用 LINE 不支援的 file message。
- 下載網址有效兩小時，可轉傳；驗證簽章後重新查同來源、目前綁定和原檔 MD5／大小。過期可再次回覆取回。
- 缺失、未保存、待重試、衝突或原檔改變仍由既有流程誠實回覆。沒有備份的過期 LINE 内容不能復原。
- Google Drive 權限保持原樣；服務透過 OAuth 讀原檔，不公開 Drive 檔案。
- 簽章／HTTPS 尚未設定的舊部署維持經驗證的 Google Drive 連結，健康資訊揭露設定完成的租戶。

共用工作區早期 collect 參考實作已調整為正式版本的 core delivery 整合；部署只能從最新 GitHub main 的 reviewed PR 完成。資料不搬移，機密不放入本包。

依據：[LINE 訊息類型](https://developers.line.biz/en/docs/messaging-api/message-types/)、[圖片規格](https://developers.line.biz/en/reference/messaging-api/nojs/#image-message)。
