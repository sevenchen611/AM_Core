# AM-IMP-2026.0608.16 Project Dossier And Task Relation Architecture

This package standardizes how AM-style projects define total-control projects and total-control tasks.

## Purpose

`總控專案庫` must be the top-level case dossier. It should show what the project is trying to complete, which tasks support completion, and what process evidence explains the current conclusion.

`總控任務庫` must be the execution layer. Each task should connect to the project it supports through a formal relation, not only through a text or select label.

## Required Relationship

```text
總控專案庫 1 -> many 總控任務庫
```

Required fields:

- `總控任務庫`.`總控專案`: relation to the project database.
- `總控專案庫`.`關聯任務`: reciprocal relation showing supporting tasks.

Legacy fields such as `專案` select may remain for compatibility, but new workflows should prefer the relation.

## Required Project Page Body

Project pages should behave like case dossiers. Properties hold current state and conclusions. Body content holds the process.

Required dossier sections:

- `案件卷宗`
- `這個專案如何完成`
- `支撐任務`
- `案件過程紀錄`
- `附件與來源`
- `目前判斷`
- `下一步`

## Scope

This version defines the shared architecture and installs the relation fields into project-local Notion databases.

It does not copy project records, source conversations, attachments, database IDs, or secrets into AMCore.
