# Install AM-IMP-2026.0610.03

Install this package separately in each production project.

## Steps

1. Read:

```text
D:\Codex_project\AM_Core\docs\TASK_BODY_EVIDENCE_LOG_STANDARD.md
```

2. Update the project-local task creation flow so every new formal task writes
   the `任務控制紀錄` structure into the task `內文`.

3. Update hourly LINE reconciliation, meeting sync, report sync, and task status
   update flows so every new judgment appends a new `證據與處理紀錄` entry.

4. For LINE-derived entries, copy the source block from the project-local
   `LINE 對話主檔` or `LINE 對話組檔` into that record's `#### 來源原文`
   section.

5. Write `來源位置` as a clickable link to the same project-local LINE
   conversation master page.

6. Preserve LINE media exactly as the conversation master stores it:

- text messages: copy the text block,
- image messages: embed the image directly,
- document/file messages: keep the file name and attachment link,
- stickers: keep sticker package/id and shop link when available.

7. Treat the separate `來源原文` Notion property as legacy or compatibility
   storage. It must not be the only source evidence location for newly created
   or updated tasks.

8. Update the project-local manifest and add a project-local upgrade record.

Do not copy task data, LINE messages, media files, Notion IDs, attachment
contents, or secrets between projects.
