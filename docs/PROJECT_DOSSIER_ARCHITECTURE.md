# Project Dossier Architecture

This document defines the AMCore standard for total-control projects and their supporting tasks.

## Core Definition

A `總控專案` is a top-level case dossier.

It is not just a category label. It is the place where the controller can understand:

- the objective,
- the success condition,
- the current state,
- the supporting tasks,
- the evidence trail,
- the decisions or ownership transfers that explain why the project is active, paused, transferred, or complete.

A `總控任務` is a specific executable or confirmable item.

Tasks support project completion. A task should be small enough that someone can own, follow up, complete, archive, or merge it.

## Required Database Relationship

Each AM project must maintain this relationship:

```text
總控專案庫 1 -> many 總控任務庫
```

Required Notion fields:

| Database | Field | Type | Meaning |
| --- | --- | --- | --- |
| `總控任務庫` | `總控專案` | Relation to `總控專案庫` | The formal project that this task supports. |
| `總控專案庫` | `關聯任務` | Reciprocal relation | The tasks that support this project. |

Legacy fields such as `專案` select may stay during migration, but they are compatibility fields, not the source of truth.

## Page Body Standard

Every meaningful project page should behave like a dossier. Properties are for state. Body content is for the process.

Recommended project page body sections:

1. 案件卷宗
2. 這個專案如何完成
3. 支撐任務
4. 案件過程紀錄
5. 附件與來源
6. 目前判斷
7. 下一步
8. 架構規則

## Completion Rule

A project is complete only when:

- the success condition is satisfied, or
- the project is explicitly transferred, paused, archived, or rejected with a recorded reason.

Completing a single task does not automatically complete the project unless that task explicitly represents the final project decision.

## Process Evidence Rule

Source conversations, attachments, report decisions, meeting notes, and controller corrections should be preserved in the project page body or linked from it.

The property area may summarize results, but the body must explain how the result was reached.

## Data Boundary

HOZO AM and Seven AM must each use their own project database, task database, LINE conversation records, attachment records, and Notion pages.

AMCore may store this architecture and templates, but must not store project records or private source conversations.
