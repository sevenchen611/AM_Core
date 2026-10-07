# 回復

先設 `AMCORE_CENTRAL_ARCHIVE_CAPTURE_ENABLED=0` 並重新部署已審查版本：停止新增捕捉與 worker，但保留中央原檔的唯讀查驗，讓已更新的原租戶附件索引仍可取檔。

不要刪除中央 SQL schema、Notion 資料庫或 Drive 原檔。原租戶資料庫、舊 Drive 原檔仍保留。排除問題後恢復 capture，worker 從未完成的持久佇列續作。

完全回退到沒有中央查驗的舊 commit，會讓引用新母資料夾的附件索引無法通過舊母資料夾守衛；必須先為這些索引另做驗證與還原，不可直接切換全租戶 Drive root 或放寬來源隔離。
