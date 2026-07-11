# `media` 模組規格

> 通用媒體管線:群組圖片/檔案的**理解 + 事件關聯**。做在平台一次,所有租戶(工程/forest/未來 AM)通用。
> 定案見 [EXTRACTION_PLAN 決策 5](../EXTRACTION_PLAN.md)。類型:通用核心。狀態:設計定案·待實作。

## 1. 目的與範圍

單張照片沒有事件就沒有意義。`media` 讓每張圖片/檔案**跟著它所屬的事件走**:理解內容、找出所屬事件、掛上去或降級相簿。

- **做**:視覺判讀(`platform.llm`)、事件關聯解析、檔名 slug、附件判讀欄位、orphan 降級。
- **不做**:落庫(collect)、空間/工項等領域詞彙(construction 經 hook 提供)、音檔(meetings)、確認佇列 UI(queue)。

## 2. 管線位置(與文字管線同形)

```
文字:  collect(落庫) → triage(通用初判) → construction.classify(領域)
圖片:  collect(落庫) → media(判讀+關聯)  → construction.classifyPhoto(領域)   ← 本規格
```

`media` 之於圖片 = `triage` 之於文字。領域掛載一律經 register 掛鉤,不進 media。

## 3. 資料流(每則 image/file 訊息)

1. **collect 先落庫**(既有):下載內容、建立「附件」記錄、原圖存 Drive `未歸檔/日期/`。collect 於 `ctx` 交棒:
   - `ctx.messagePageId`(照片自己的訊息頁)
   - `ctx.attachmentPageId`(附件記錄)
   - `ctx.media = { buffer, contentType }`(避免 media 重抓)
2. **media.onMessage**(只處理 image/file;audio 交給 meetings):
   1. **視覺判讀**:`platform.llm` 帶影像 → `{ topic, tags[], caption, isEvidence, confidence }`(通用,不含空間/工項)。連拍合併成一次呼叫(見 §7)。
   2. **事件關聯解析**(§4):在同群時間窗內找最相關的「判定事件」→ `{ eventMessageId, score }` 或 `null`。
   3. **領域掛載**:若租戶有 `platform.classifyPhoto`(construction)→ 交它定 `{ space, work_item, ticket }`;無 → 略過,走 §6 降級。
   4. **寫回**(§5):附件記錄寫 `AI影像判讀` JSON + 檔名 slug;把附件的事件關聯指向 `eventMessageId`(讓 queue 確認該事件時,`archiveAttachments` 一併掛照片)。
   5. 回 `true`(已處理),短路後續模組。

## 4. 事件關聯解析器

**候選事件** = 同群組、`|Δt| ≤ W` 內、屬「有意義」的訊息(有 judgement、或類型 ∈ {問題反映,進度回報,提問}、或已掛載空間/工項)。**前後都看**(人可能先拍後講、或先講後拍)。

**評分**(各項 0~1,加權後取最高):

| 訊號 | 說明 | 預設權重 |
|---|---|---|
| `timeProximity` | `1 - |Δt|/W`(越近越高) | 0.35 |
| `semanticSim` | 照片 `topic/tags` vs 事件文字/judgement 的語意相符 | 0.30 |
| `isReplyTo` | LINE 該照片是「回覆」某事件訊息 → 直接鎖定 | 0.25(命中即高) |
| `sameBurst` | 與已關聯的同批連拍屬同一事件 | 0.10 |

- `score ≥ HI` → 自動關聯 + 掛載。
- `MID ≤ score < HI` → 關聯但標 `待人工確認`(進審核視圖,不擋)。
- `score < MID` 或無候選 → **orphan**,走 §6。

## 5. 存檔 schema(不把判讀塞進檔名)

分層:檔名放**短 slug** 供人眼掃,完整判讀放**結構化欄位**供查詢/稽核(比照文字的 `AI 初判結果`)。

**檔名 slug**:`YYYY-MM-DD_<空間或群名>_<主題>_<序>.<ext>`
- 例:`2026-07-11_301房_浴室漏水_01.jpg`;無 construction 時 `<空間>` 退回群名/事件關鍵詞。
- 清洗非法字元、單段長度上限、序號防撞。

**附件記錄新增欄位**:
- `AI影像判讀`(rich_text,存 JSON):
  ```json
  { "topic": "浴室漏水", "tags": ["磁磚","滲水","牆面"], "caption": "301房浴室牆面磁磚滲水痕跡",
    "isEvidence": true, "confidence": "高", "model": "MiniMax-M3",
    "eventMessageId": "<page>", "resolverScore": 0.82, "resolvedBy": "time+semantic" }
  ```
- `事件關聯`(relation → 訊息):指向解析出的事件訊息(供 `archiveAttachments` 掛載)。
- `檔名`(既有 rich_text,寫 slug)。

## 6. Orphan 降級(找不到事件)

**不進確認佇列**(不留 `未掛載`)。依租戶:
- 有 construction:掛到該群綁定的**預設空間相簿**(空間 relation),`掛載狀態 = 一般對話·相簿`。
- 無 construction(forest 等):`掛載狀態 = 一般對話·相簿`,Drive 依 `日期` 歸檔。
- (config-gated)機器人回一句「這張是哪個空間/工項?」→ 使用者一鍵補脈絡,補後回頭跑 §4.3。

## 7. 效能 / 成本

- **連拍合併**:同群 `≤ B` 秒內多張 → 一次多圖 `platform.llm` 呼叫,共用一次關聯(同一事件)。
- MiniMax 是便宜層;合併後單事件一次判讀,可接受。
- 判讀/掛載走背景(webhook 已先回 200),不阻塞。

## 8. 介面契約

**media 消費的 platform 服務**
- `platform.llm(..., { images })` — 視覺判讀(MiniMax M3 已 `supportsImages`)。
- `platform.classifyPhoto(ctx)` — **register 掛鉤,construction 提供,選配**。無則走降級。
- `platform.uploadToDrive` / `platform.ensureDriveFolder` — 歸檔。

**`platform.classifyPhoto(ctx)`(construction 實作)**
```
輸入 ctx: { tenant, binding,
            photo: { caption, topic, tags, isEvidence, attachmentPageId },
            event: { messagePageId, judgement, space, work_item } | null }
輸出:     { space, work_item, ticket_suggested, mountTarget } | null
```
- construction 內用專案的空間/工項清單把照片定位;可建議開/掛回饋單(證據型)。
- forest 無 construction → 此 hook 不存在 → media 走 §6。

## 9. 每租戶行為

| 租戶 | 判讀 | 事件關聯 | 領域掛載 | Orphan |
|---|---|---|---|---|
| engineering(有 construction) | ✓ | ✓ | 空間/工項/回饋單 | 空間相簿 |
| forest(無 construction) | ✓ | ✓ | — | 日期相簿 |

## 10. 設定(per-tenant,`config.media`)

- `enabled`(預設 true)、`window W`(預設 10 分)、`burst B`(預設 90 秒)、`scoreHi/scoreMid`、`askOnOrphan`(預設 false)、`visionModel`(預設走 `platform.llm` cheap profile)。

## 11. 非目標 / 邊界

- 不碰音檔(meetings)。不定義空間/工項(construction)。不做佇列 UI(queue)。不改 collect 的落庫職責。

## 12. 落地順序(降風險)

1. **關聯解析器**(時間鄰近 + LINE 回覆),不含視覺 → 先讓照片會跟事件跑(解 8 成 orphan)。
2. **視覺判讀**(MiniMax)當消歧義 + caption + slug + 判讀欄位。
3. **construction.classifyPhoto** hook + orphan 相簿降級。
4. BuildAM 以 vendored 帶入;移除治標的會議噪音過濾(`3c03258`)。
