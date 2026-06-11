# AM-IMP-2026.0610.03 Task Body Evidence Log Standard

This package defines the shared task body format for AM total-control tasks.

## Purpose

AM must be able to explain why a task exists, why its status changed, and what
should happen next. The task body therefore becomes an append-only evidence and
judgment log.

Every task creation or task update must write the source original, evidence
summary, AM judgment, processing result, status change, and next step into the
same record in `內文`.

## Standard

| Item | Requirement |
| --- | --- |
| Task body | Must use `任務控制紀錄` with `目前任務摘要`, `最新判斷`, and `證據與處理紀錄`. |
| Evidence records | Must be append-only. Each new source or decision adds a new `紀錄`. |
| Source original | Must live inside the matching record, not only in a separate `來源原文` property. |
| Source location | Must be clickable when a project-local source page exists. LINE records link to the LINE conversation master page. |
| LINE text | Preserve the LINE conversation master block format exactly. |
| LINE image | Place the image directly in `來源原文`, matching the LINE conversation master. |
| LINE document/file | Preserve the file name and attachment link; do not expand the document content. |
| AM interpretation | Write only in `證據摘要`, `AM 判斷`, `處理結果`, and `下一步`, not inside raw `來源原文`. |

## Main Document

Read the shared standard:

```text
docs/TASK_BODY_EVIDENCE_LOG_STANDARD.md
```

Machine-readable contract:

```text
versions/AM-IMP-2026.0610.03/config/task-body-evidence-log-standard.json
```

Reusable migration tool:

```text
tools/apply-task-body-evidence-log-standard.js
```

## Scope

Apply separately to:

- HOZO_AM
- SevenAM

AMCore stores only the shared rule and templates. Project-local LINE messages,
task records, media, files, Notion IDs, and secrets stay inside each project.

## Definition Of Done

- Task creation writes the new body format into project-local total-control
  tasks.
- Task updates append a new evidence record instead of overwriting older
  records.
- LINE source originals are copied from the project-local LINE conversation
  master in the same format.
- Image messages render directly in the matching evidence record.
- Document/file messages preserve the file name and attachment link.
- The legacy `來源原文` property is no longer the only raw evidence store for new
  task events.
