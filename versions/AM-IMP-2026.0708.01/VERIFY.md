# Verify

1. `/health` 回報 lineConfigured / notionConfigured / groupRoutingEnabled /
   attachmentsConfigured / driveConfigured / aiJudgeEnabled / confirmQueueEnabled /
   dueRemindersEnabled 全為 true。
2. 綁定群組發文字+照片:訊息落庫掛專案,照片進 Drive 未歸檔,AI 初判寫回。
3. 佇列確認一筆含照片訊息:照片搬入 專案/空間/工項/日期。
4. 問題反映開立回饋單:編號正確、來源證據完整、開單公告送達。
5. `/cron/reminders?key=` 手動觸發:到期單推播原群組並真 @ 負責人。
6. 傳一段會議錄音:產出會議記錄(摘要/決議/checkbox 待辦/回放連結)並發布回群。
7. Portal 帳號僅勾部分子專案時,儀表板與佇列只顯示該專案資料。

BuildAM 實測記錄:M1 驗收通過(收集 100%、AI 類型 97%/空間 94%),
其餘功能均以茲心園/草悟道館真實資料驗證(見 BuildAM docs/)。
