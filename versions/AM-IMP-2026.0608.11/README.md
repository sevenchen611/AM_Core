# AM-IMP-2026.0608.11 Report Intervention Action Standard

This package standardizes the actions a controller can take when a scheduled report presents candidate items.

The purpose is to turn reports from passive summaries into controlled decision surfaces. Every candidate item should expose the same six actions:

1. `建立任務`
2. `不是任務`
3. `改專案`
4. `指定專案目標`
5. `指定任務目標`
6. `要求負責人口述目標`

## What This Package Defines

- A shared action registry.
- The candidate item data contract.
- Decision statuses.
- Required Notion fields for report intervention tracking.
- Report-slot expectations for 08:00, 10:00, 13:00, 17:00, and 20:30.
- Install and verification rules for HOZO_AM and SevenAM.

## Scope

This version defines the standard. It does not copy project data and does not contain any project database IDs.

Each production project must install the standard into its own runtime, report UI, and project-local Notion databases.

