# 驗證

```powershell
node --test tools/test-construction-journal.mjs
node tools/dryrun-construction.mjs
node tools/dryrun-construction-dashboard-management.mjs
node tools/check-upgrade-package.js AM-IMP-2026.1005.01
node tools/audit-alignment.js
node tools/compare-project-manifests.js
```

日誌測試涵蓋工班人數去重、未知與零、來源保留、跨租戶／案件拒絕、預算權限、直接更新／舊版確認權限、重送／同程序併發、防止變更已保存回報、索引寫入中斷復原、補登依施工日期排序、同日最新回報優先、作廢保留證據、照片 scope／格式、頁面腳本語法與 boot XSS、API JSON 解析及 scope。

正式環境驗證須逐項留在工程部署本地：

- 開啟每個案件，能選到原有工項；能由原工項反向找到同一施工紀錄，不能誤連同名其他案件。
- 兩筆施工內容共用同一工班 4 人，日誌只記 4 人。未知不變 0；無施工日保存原因。
- 一般成員提交新日誌即「已更新」，不用 owner 確認；原有工項及現場空間詳情下方出現相應的施工內容／工班／人數／照片。填報人不能由 body.operator 偽造。
- 補登舊日報，保留來源與原文；較早施工日期不能覆蓋新完成率。
- 實際上傳現場 JPEG／PNG，確認 Drive 原檔位於工程租戶／案件／日期資料夾並可開啟。既有 LINE 照片只有同案件可選。
- 使用兩個不同館別與非工程租戶的實際登入身分測拒絕；偽造 URL scope／budget／contract 不可升權。確認失敗時無寫入。
- 模擬中途寫入錯誤，日誌停在整理中、正式進度不顯示半套結果；原填報者原識別碼重送復原。
- 錯誤日誌作廢後從正式進度排除；原文、原確認者、作廢原因仍能查到。
- JSON 匯出包含日誌原始回報、工班、來源與工項進度；列印使用瀏覽器另存 PDF，並非伺服器 PDF 生成。
- 不修改既有合約、驗收、付款、金額或正式任務狀態。

初版本機 UI 合成示範已驗證（已被下方直接更新政策取代）：開案 → 工班 6 人／工項回報 → 提交成功 → 待確認日誌與對應工項紀錄出現。尚未執行上述正式環境驗證；未宣告全域 alignment complete。

## 2026-10-05 本輪結果

- `node --test tools/test-construction-journal.mjs`：12/12 通過。
- 工程既有乾跑：12/12；dashboard master-data 乾跑：7/7，隔離通過。
- 本工作區 `check-upgrade-package.js`：套件完整；schema provision 預設計畫模式：無寫入，尚無正式日誌資料來源綁定。
- 本工作區 `audit-alignment.js`：exit 0、errors 空陣列；保留既有腳本／manifest warning。
- 已依 AGENTS 執行 `D:\Codex_project\AMCore\tools\audit-alignment.js`：exit 1，該舊 checkout 有既有 HOZO／Seven manifest 缺列；其 package checker 找不到本輪新套件。舊 checkout 與目前 `D:\CodexWork\AM_Core` 為不同目錄，未複製套件或改舊專案來製造一致性。
- 已執行舊目錄與本工作區 `compare-project-manifests.js`；本版不適用 HOZO／Seven，metadata 明列 Blocked、舊 BuildAM Deprecated，工程 AM Platform 維持 Ready。沒有宣告 Installed／Deployed。
- 本機浏览器已實際操作工班／工項填寫與提交，日誌「待確認 · 6 人」與 work-1 的「今日施作量 12 平方公尺、回報累計 35%」出現；正式顯示百分比仍維持此前已確認的 20%。截圖全部為合成資料。

## 2026-10-05 續建結果

- 工程日誌測試擴增為 14/14 通過；套件完整性檢查再次通過。
- 新增重複同名工班／同工種拒絕提交，避免人數重複計算。
- 原始來源、原文與施工證據過長時拒絕保存，保留表單讓使用者分段或附原檔参照；8,000 字原文邊界測試確認完整保存，沒有靜默截短。
- 重複作廢測試確認第一次的作廢原因與操作者維持不變，原確認證據仍保留。
- 當時正式資料庫位置與正式進度確認人仍未取得，尚未執行正式建庫／部署／既有報表回填。保留完整目標，沒有將本機示範當作全案件建置完成。

## 2026-10-05 使用者確認格式與直接更新政策

- 使用者授權：提交後直接更新，不需管理者確認。16/16 測試通過：一般成員直接生效、同日最新回報優先、補登舊日期不倒退、原工項／現場／預算依關聯篩選、跨案件及跨現場拒絕、dashboard doc API 與內嵌腳本。
- 原工程詳情既有內容下方新增施工紀錄區；矩陣同格多個工項均可開啟，日誌入口預選原工項。補正既有設計圖上傳按鈕的模板引號，避免整個 dashboard 腳本解析失敗。
- 正式接入尚未完成；沒有建立正式資料庫、部署服務或搬入現場紀錄。
- 瀏覽器實際提交合成工班 6 人、施作量 12 平方公尺、35% 完成率後，日誌直接為已更新，工項由 20% 到 35%；原工項詳情下方保留新舊兩筆紀錄。點新增日誌預選 work-1 與合成一樓現場。截圖 preview-journal.jpg、preview-work-history.jpg 均為合成資料。
- 工程既有乾跑 12/12、dashboard 主資料乾跑 7/7、套件完整性檢查通過；provision 預設計畫無寫入，現場資料來源納入必需關聯。
- 本工作區 alignment audit 再次 exit 0、errors 空陣列，保留既有 warnings；AGENTS 指定舊 checkout 的 audit 再次 exit 1，仍為原有 HOZO／Seven manifest 缺列。版本比較已執行，本工程套件仍 Ready，沒有宣告全域對齊或正式部署完成。

## Production-source integration, 2026-10-05

Integrated from verified GitHub main/production commit b5f87849a9aa18b73b34a1e80b5efbbe995e03d2 in an isolated checkout. Journal 16/16, dashboard master-data 14/14, engineering convergence 18/18, core isolation 19/19, task-card and package checks passed. Existing contracts, multi-space work items, Gantt editing and project Notion links are retained. Deployment database setup will run using the existing service environment; no production secret or binding is copied to AMCore.

Live canary (explicit deployment operation): use `tools/verify-construction-journal-live.mjs engineering --prepare /tmp/engineering-journal-canary.json` to create a clearly labelled synthetic case/site/work item and verify a real Drive photo upload/download. Submit its journal through the authenticated web form with 6 people, 35% and its one photo, then run `--verify` and `--cleanup` using the same state path. Cleanup archives only synthetic Notion pages and moves their unique Drive case directory to recoverable trash. Shared Drive root and real cases are retained. State and all binding IDs remain outside AMCore.

Audit on the production-source checkout ran and reported pre-existing HOZO/Seven manifest/path gaps; no new engineering error was reported. This release does not claim global alignment completion.
