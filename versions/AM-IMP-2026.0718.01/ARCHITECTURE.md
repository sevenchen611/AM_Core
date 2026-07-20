# AM Operational Memory Architecture

## 1. 目標運作模型

AM 的主要讀取對象不是整段聊天，而是持續更新的公司運作模型：

```text
租戶 / AM
├─ 專案／目標：成功條件、階段、目前狀態、下一步、阻礙、風險
├─ 任務：負責人、承諾、期限、等待對象、目前狀態、歷程
├─ 決策：內容、理由、影響、有效期間、取代關係
└─ 知識：經核准、版本化、具有適用範圍的正式內容
```

所有結論都可沿著來源關聯回到 LINE 訊息、會議、報告、附件、人工更正或系統建議。

## 2. 四層資料模型

### L1 原始來源層

保存不可被日常流程改寫的來源事實：訊息 envelope、原始文字、回覆關係、發送者、時間、附件 metadata、內容雜湊與擷取結果。Webhook 只做驗證、冪等保存與排隊，完成後立即回覆 LINE。

### L2 結構化事件層

以 topic thread 為判斷單位產生事件，不以單一訊息為單位大量建任務。事件可為 task、decision、request、issue、progress_update、commitment、meeting、risk、information、question、completion、cancellation 或 change。

事件先以 `candidate` 寫入；只有通過 schema、租戶、來源證據、規則與信心檢查後才能變成 `confirmed`。後來資訊推翻舊資訊時，新增事件並使用 `supersedes_event_id`，不刪除歷史。

### L3 專案當前狀態層

`projects`、`project_goals`、`tasks`、`decisions` 是目前有效狀態；`task_history`、事件取代鏈與 project snapshots 保存歷程。正式任務必須連到 project goal；會議 checkbox 等已確認的真實任務若目標未知，先保留為 candidate。狀態引擎收到 confirmed event 後，必須先搜尋可吸收它的既有任務，再決定更新、重開、完成、改派、延期、取代決策或建立新項目。

### L4 經核准知識層

聊天內容預設只能成為 knowledge candidate。只有主管發布、人工核准或符合專案治理規則後，才能成為 active knowledge。每個知識項目有 owner、適用範圍、版本、生效與到期日、複核日及來源。

## 3. 共用服務與 adapter 邊界

```text
LINE / 會議 / 報告 / 人工修正
             │
             ▼
Source adapters ──驗證與冪等──► PostgreSQL raw source
             │                         │
             └────► Queue / workers ◄──┘
                         │
       OCR / STT / 文件抽取 / topic threading
                         │
                         ▼
             LLM structured extraction
                         │
              schema + evidence gate
                         │
                         ▼
               reconciliation engine
              ┌──────────┼──────────┐
              ▼          ▼          ▼
           Project      Task      Decision
              └──────────┼──────────┘
                         ▼
          query service / Notion projection
                         │
                         ▼
                權限過濾後的 AM 答案
```

共用核心只接受標準化 envelope。LINE、Notion、會議與報告的專案差異全部留在 adapter 與 tenant config；核心不得讀取其他 AM 的環境變數或資料。

## 4. 寫入流程

1. 驗證 webhook 簽章與租戶路由。
2. 以 `(tenant_id, source_system, external_message_id)` 冪等保存原始訊息。
3. 寫入 processing job/outbox 後回覆來源平台。
4. worker 下載附件並進行 OCR、STT 或文件文字擷取。
5. 依 reply chain、主題切換、參與者與 5–15 分鐘時間連續性建立 topic thread。
6. 載入 AMCore 共用規則、project-local judgment rules、learned calibration rules 與 User UI manual rules。
7. LLM 依固定 JSON Schema 提出 candidate events；自由文字不得直接寫入 current state。
8. 驗證 tenant、來源、規則 trace、信心、狀態與日期。
9. reconciliation engine 先找既有 project/task/decision，再套用 `update_existing`、`create_new`、`supersede`、`candidate_review` 或 `no_action`。
10. 同一交易追加 event、history、current state 與 projection outbox。
11. Notion projector 可稍後重試，不影響 PostgreSQL 的寫入與查詢。

## 5. 查詢流程

1. 建立 AccessContext：租戶、使用者、群組、專案、角色與敏感等級。
2. 辨識問題意圖與 project/person/time 範圍。
3. 優先查 `projects`、active `tasks`、effective `decisions`、recent confirmed `events`。
4. 只有需要細節、原文、附件或矛盾確認時，才檢索 raw source 與向量索引。
5. 對每筆候選證據再次套用權限過濾，禁止先檢索後遮罩。
6. 回答固定輸出目前狀態、最新進度、下一步、負責人、尚待確認與資料依據。
7. 將問題、查詢範圍、使用來源、答案、信心與使用者回饋寫入 answer log。

## 6. 真實來源分工

| 資料 | Source of truth | Notion 角色 |
| --- | --- | --- |
| 原始訊息與附件 metadata | PostgreSQL / object storage | 可選來源連結 |
| 事件與取代鏈 | PostgreSQL | 稽核或人工覆核投影 |
| 任務目前狀態與歷史 | PostgreSQL | 看板與人工操作投影 |
| 決策與理由 | PostgreSQL | 決策確認與閱讀投影 |
| 專案 snapshot | PostgreSQL | 專案頁與週報投影 |
| 正式知識 | PostgreSQL version record | 編輯、審核與閱讀投影 |

Notion 允許的人工修改必須轉換成 `manual_correction` 或 `approval` event，再由相同 evidence gate 與 reconciliation 流程處理。禁止兩邊直接 last-write-wins。

## 7. 多租戶隔離

- 每張 operational-memory 表都包含 `tenant_id`，所有唯一鍵都包含租戶範圍。
- 應用層 AccessContext 與 PostgreSQL `app.tenant_id` 必須一致。
- PostgreSQL 對資料表啟用並強制 RLS；worker、scheduler、搜尋與 projection 都不能繞過。
- object key 使用 tenant prefix，簽名下載前再次驗證 AccessContext。
- embedding、全文索引與 reranking 在 SQL/retrieval query 時先過濾 tenant 與 access scope。
- answer source 不保存可跨租戶重用的 raw cache。
- 每個 AM 使用自己的 connector credentials、Notion database IDs、LINE channel、object prefix 與 project-local upgrade record。

## 8. 一致性與失敗處理

- Webhook 可重送：idempotency unique key 保證只寫一次。
- worker 可重跑：processing job 有 attempt、lease、next retry 與 dead-letter 狀態。
- LLM 可重分析：保留 model/prompt/rule version；新分析以新 event proposal 追加，不覆蓋舊 trace。
- Notion 暫時失效：projection outbox 重試；核心仍可回答。
- 矛盾資訊：保留兩邊來源，低信心時進 review；只有明確取代關係才更新 effective state。
- 敏感、財務、法律、HR、合約或外部承諾：即使高信心仍需 owner confirmation 才能 final close 或對外執行。

## 9. 建議分期

### M0 — 基礎與 shadow

建 schema、租戶邊界、raw ingestion、queue、來源證據與觀測；不改現有對外回答。

### M1 — 三項 MVP

啟用 project progress、task/commitment、decision extraction 與 reconciliation；與現有 Notion 結果平行比較。

### M2 — 結構化優先問答

把專案進度、任務與決策問題切到 structured-first query；原文只在需要證據時取回。

### M3 — Notion projection 與人工治理

啟用 projection、人工更正事件、低信心 review queue、決策核准與知識升格。

### M4 — 記憶生命週期與最佳化

啟用 pgvector、熱溫冷分層、封存、保留政策、答案回饋校準與成本優化。
