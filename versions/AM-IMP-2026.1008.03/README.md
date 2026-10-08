# 影片與音訊下載副檔名

Status: Installed. Production verification pending.

LINE 影片原檔可以完整保存，但以回覆原訊息補存時，LINE 沒有提供原檔名，舊版只建立 file-<message> 且下載回應一律使用 application/octet-stream、ASCII 檔名 attachment。裝置會把正確的 MP4 當作不明檔案。

本版使用經指紋驗證的 Drive MIME 補齊既有無副檔名的下載檔名，並送出相應 Content-Type；UTF-8 與 ASCII Content-Disposition 都含副檔名。新 LINE 影片、音訊、圖片及 PDF 的自動檔名也含 MIME 對應副檔名。已提供的副檔名保留，未知 MIME 不猜測格式。此為下載與命名修正，原始 bytes、Drive 原檔名、保存指紋、來源權限和舊簽章網址維持原本依據。

不需要重傳舊原檔；既有未過期網址在新版服務部署後就會下載為有副檔名的檔案。沒有保存資料或機密於此共用包。
