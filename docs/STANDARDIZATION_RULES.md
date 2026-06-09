# AM Project Standardization Rules

## Main Principle

Shared code should not know whether it is running as HOZO_AM, SevenAM, or another AM project.

Project identity must come from environment variables and project-local configuration.

## Code Rules

Do not hard-code project names in shared code.

Avoid:

```text
HOZO_LINE_CONVERSATION_DATABASE_ID
SEVEN_LINE_CONVERSATION_DATABASE_ID
```

Prefer:

```text
PROJECT_CODE
PROJECT_DISPLAY_NAME
PROJECT_BRAND_PREFIX
NOTION_CONVERSATION_DATABASE_ID
NOTION_MESSAGE_DATABASE_ID
NOTION_ATTACHMENT_DATABASE_ID
```

## Environment Rules

Each project owns its own `.env`.

The `.env` should contain:

```text
PROJECT_CODE=
PROJECT_DISPLAY_NAME=
PROJECT_BRAND_PREFIX=

LINE_CHANNEL_ACCESS_TOKEN=
LINE_CHANNEL_SECRET=

NOTION_TOKEN=
NOTION_CONVERSATION_DATABASE_ID=
NOTION_MESSAGE_DATABASE_ID=
NOTION_ATTACHMENT_DATABASE_ID=
NOTION_TASK_DATABASE_ID=
NOTION_RESPONSIBILITY_DATABASE_ID=
NOTION_LINE_GROUP_OPTIONS_DATABASE_ID=
NOTION_LINE_GROUP_MEMBERS_DATABASE_ID=

RENDER_SERVICE_NAME=
GITHUB_REPOSITORY=
```

Existing project-specific prefixes may remain during migration, but new shared code should move toward generic names.

## Naming Rules

Notion database names may include the project brand, but code should not depend on those names.

Recommended display format:

```text
{PROJECT_BRAND_PREFIX} LINE 對話主檔
{PROJECT_BRAND_PREFIX} LINE 訊息紀錄
{PROJECT_BRAND_PREFIX} LINE 附件紀錄
{PROJECT_BRAND_PREFIX} 總控專案庫
{PROJECT_BRAND_PREFIX} 總控任務庫
{PROJECT_BRAND_PREFIX} 責任權責資料庫
{PROJECT_BRAND_PREFIX} LINE 群組選項資料庫
{PROJECT_BRAND_PREFIX} LINE 群組成員資料庫
```

## Total-Control Project Architecture

`總控專案庫` is the top-level case and project dossier database.

Each project row represents an outcome container, not a single task. A project must answer:

- What outcome should be reached?
- What condition makes this project complete?
- What risks, decisions, and next actions matter?
- Which tasks support completion?
- What process evidence explains how the current conclusion was reached?

`總控任務庫` is the execution tracking database.

Each task row represents one actionable item that supports a project or stands alone until the controller assigns it to a project.

Required relationship:

```text
總控專案庫 one-to-many 總控任務庫
```

The task database must include a relation field named `總控專案` that points to the project database. The project database must expose the reciprocal relation field named `關聯任務`.

Legacy select fields such as `專案` may remain temporarily for compatibility, but new automation, reports, and controller workflows should prefer the `總控專案` relation.

Project pages are dossiers. The property area stores state and conclusions; the page body stores process evidence:

- 支撐任務
- 完成條件
- 對話時間線
- 附件與來源頁
- 決策轉折
- 暫停、轉交、或完成原因

## Total-Control Task Architecture

`總控任務庫` is also a dossier layer, not only a flat to-do list.

A task may be a parent task when it requires other work tracks before it can close. In that case, the task database must support self-relations:

```text
總控任務庫 parent task one-to-many 總控任務庫 child tasks
```

Required fields:

- `母任務`: relation from a child task to its parent task in the same project-local task database.
- `子任務`: reciprocal relation showing the child tasks that support or gate a parent task.

Parent tasks should not be marked complete until child tasks are complete, cancelled, transferred, or explicitly no longer needed. If a child task is only related to the same project but does not directly gate the parent task, keep it as a sibling under the same `總控專案` relation instead of nesting it.

Task pages are work dossiers. Properties summarize the current state; the page body preserves the process:

- 任務定位
- 完成定義
- 任務階層
- 對話時間線
- 附件與來源
- Codex 判斷
- 狀態變更紀錄
- 下一步

Conversation-derived tasks should preserve the thread-level story, not only one isolated message. File-derived tasks should link the attachment page and explain how the file supports the parent task.

## Data Boundary Rules

The following must never be copied between projects:

- `.env` values
- LINE tokens and secrets
- Notion tokens
- Notion database IDs
- Render environment values
- Customer messages
- Task records
- Report records
- Attachment records
- Automation logs

The following may be shared through AM_Core:

- Code structure
- Script templates
- Notion schema templates
- JSON configuration format
- Verification checklist
- Upgrade package definitions
