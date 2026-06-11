# Total-Control Task Body Evidence Log Standard

This document defines the shared AM rule for writing the `內文` body of every
formal total-control task.

## Core Principle

The task body is AM's evidence and judgment log.

Every formal task must show, inside `內文`, how AM reached the current task
state:

- what source evidence was captured,
- what original source text or media was used,
- what AM judged from that evidence,
- what AM changed or did,
- what the next step is.

`來源原文` is not a separate mixed bucket for all raw evidence. The authoritative
raw source for each task action must be placed inside the matching evidence log
entry in `內文`, directly before the summary and AM judgment for that same entry.

## Field Roles

| Field | Role |
| --- | --- |
| `內文` | Primary task control record: task summary, current status, evidence log, AM judgment, processing result, status changes, and next step. |
| `來源原文` | Legacy or compatibility field only. It may be blank, show the latest source, or say that full source evidence is recorded in `內文`. It must not be the only place where evidence is stored for new task records. |

## Required Body Structure

New and updated task pages should use this structure:

```markdown
# 任務控制紀錄

## 目前任務摘要
- 任務：
- 專案目標：
- 目前狀態：
- 負責人：
- 下一步：
- 需要確認：

## 最新判斷
- 判斷時間：
- 判斷來源：
- 判斷結果：
- 判斷理由：
- 信心程度：
- 是否需要人工確認：

## 證據與處理紀錄

### 紀錄 1
- 擷取時間：
- 來源類型：LINE / 會議紀錄 / 日報 / 系統建議 / 附件 / 其他
- 來源位置：
- 來源時間：
- 來源對象：

#### 來源原文


#### 證據摘要


#### AM 判斷


#### 處理結果


#### 狀態變更


#### 下一步


#### 關聯規則

```

## Append-Only Rule

`證據與處理紀錄` is append-only.

When AM creates a task, updates a task, changes status, changes owner, changes
due date, changes next step, detects a blocker, detects completion, or decides
that a new source is only background context, it must append a new record instead
of overwriting the older record.

Older records may be corrected only when a project owner explicitly confirms a
data repair. Repairs must themselves leave an audit note.

## LINE Source Original Rule

When the source is LINE, `#### 來源原文` must preserve the LINE conversation
master format.

Rule:

```text
LINE 對話主檔裡面放什麼，任務內文的「來源原文」就放什麼。
```

AM must not summarize, rewrite, normalize, or split the original source block
inside `來源原文`. AM's interpretation belongs in `證據摘要`, `AM 判斷`, and
`處理結果`.

The standard LINE source block is:

```text
【日期時間】群組名稱 - 發言人（訊息格式）
訊息內容
```

If the LINE conversation master uses an assistant/system format, preserve that
format:

```text
【日期時間】Seven Jr.：訊息格式
訊息內容
```

Each LINE source block must preserve:

- date and time,
- group or conversation name,
- speaker or sender,
- message format,
- message content,
- line breaks,
- URLs,
- emoji and stickers,
- image markdown,
- file names and file links.

## Source Location Link Rule

`來源位置` must be clickable whenever the source has a project-local source page.

For LINE-derived task records, `來源位置` must link directly to the project-local
`LINE 對話主檔` or `LINE 對話組檔` page that contains the original conversation.

Example:

```markdown
- 來源位置：[Andy & Seven / Seven LINE 對話主檔](https://app.notion.com/p/37951c686dac815caa80f59631e4d06d)
```

Rules:

- Do not store only the plain group name when a conversation page URL is known.
- The link must open the conversation page, not just the task page or project
  page.
- Files and documents still keep their own attachment links inside
  `#### 來源原文`.
- A reader should be able to click `來源位置` to view the complete original
  conversation, then click any file link inside `來源原文` to view the original
  document record.

## LINE Text Messages

For text messages, copy the message block as it appears in the project-local
LINE conversation master.

Example:

```markdown
#### 來源原文

【2026/6/8 下午3:55】Andy & Seven - Seven陳聖文（文字訊息）
Andy，那個房間間數，66 間跟 50 間差的 16 間是在哪一邊？

再來，餐廳是在二樓嗎？一樓有餐廳嗎？
```

If the source master stores visual line breaks as rendered line breaks, preserve
them as line breaks in the task body.

## LINE Image Messages

If the LINE source is an image, place the image directly inside `來源原文` using
the same image form used by the LINE conversation master.

Example:

```markdown
#### 來源原文

【2026/6/8 下午11:44】Andy & Seven - Andy Tsai（圖片）
![617572952405180914](圖片網址或專案本地圖片連結)
```

Rules:

- Do not replace the image with only `圖片` or a message id.
- Do not move the image to a separate attachment section.
- Do not describe the image in `來源原文`.
- If AM needs to describe what the image shows, write that in `證據摘要`.

## LINE File Or Document Messages

If the LINE source is a document or file, preserve the LINE conversation master
format and keep the file as a link.

Example:

```markdown
#### 來源原文

【2026/6/8 下午3:54】Andy & Seven - Seven陳聖文（檔案）
檔案：組合（無謄本）南投縣鹿谷鄉內湖村興產路24-17、24-18號.pdf
[附件資料庫：組合（無謄本）南投縣鹿谷鄉內湖村興產路24-17、24-18號.pdf](https://app.notion.com/...)
```

Rules:

- Do not expand document contents into `來源原文`.
- Do not download or copy the document into AMCore.
- Do not convert the file link into a different citation style.
- If AM reviewed the document and made a judgment, write the judgment in
  `證據摘要` or `AM 判斷`, while keeping the document source block unchanged.

## LINE Sticker And Other Messages

Sticker messages should preserve the sticker marker and available shop link:

```markdown
#### 來源原文

【2026/6/10 上午12:11】Andy & Seven - Andy Tsai（貼圖）
[sticker] package:16601926 sticker:430581586
[LINE sticker shop page](https://store.line.me/stickershop/product/16601926)
```

Other non-message events should be copied only when they are needed to explain a
task judgment. Otherwise, they may stay in the LINE conversation master and not
be used as task evidence.

## Multiple Source Messages In One Record

If one AM judgment depends on several LINE messages from the same topic thread,
place all relevant original message blocks inside the same `來源原文` section.

Keep each message block complete. Do not merge speakers or combine message
contents into one rewritten paragraph.

Example:

```markdown
#### 來源原文

【2026/6/8 下午11:30】Andy & Seven - Seven陳聖文（文字訊息）
Andy，下午 2 點太趕了，我們改 3 點可以嗎？

【2026/6/8 下午11:41】Andy & Seven - Andy Tsai（文字訊息）
好的 約好了👌

【2026/6/8 下午11:41】Andy & Seven - Andy Tsai（文字訊息）
15:00跟陳董約在夏緹飯店
```

## Evidence Summary Rule

`證據摘要` is AM's concise explanation of the source.

It should answer:

- what the evidence says,
- why it matters to the task,
- whether it creates a new task or updates an existing task,
- whether it changes status, owner, due date, or next step.

`證據摘要` must not replace `來源原文`; both are required when the source is used
to create or update a formal task.

## AM Judgment Rule

`AM 判斷` records the reasoning result.

Examples:

- This is a new task because the speaker requested a concrete follow-up.
- This is not a new task; it completes an existing request.
- This is a candidate task because the project goal is unclear.
- This is a status update because the later reply confirms the requested data
  was provided.

## Processing Result Rule

`處理結果` records what AM did after judging the evidence.

Examples:

- Created a formal task.
- Kept as candidate task pending project-goal clarification.
- Updated status from `待處理` to `待確認完成`.
- Updated next step.
- Did not create a task because the message was an assistant operation command.

## Source Boundary

AMCore stores this shared standard only. It must not store live LINE messages,
customer data, media files, attachment contents, Notion database IDs, or secrets.

HOZO_AM and SevenAM must apply this standard inside their own project-local task
databases and LINE conversation records.

## Validation Checklist

A task body passes this standard when:

- `內文` contains `任務控制紀錄`.
- `內文` contains `證據與處理紀錄`.
- Each creation or update event has a separate `紀錄`.
- Each formal task creation record has `來源原文`, `證據摘要`, `AM 判斷`,
  `處理結果`, and `下一步`.
- LINE source original blocks preserve the LINE conversation master format.
- Image messages show the image directly in the matching source record.
- File/document messages show the file name and attachment link in the matching
  source record.
- `來源原文` is not used as the only evidence storage for new task events.
