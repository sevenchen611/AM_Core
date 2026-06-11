# AM-IMP-2026.0610.02 Task Source Evidence Gate

This package makes source evidence mandatory for every formal AM task.

## Purpose

AM exists to convert conversations and meeting records into reliable project
control. A task without source evidence cannot be audited, corrected, or trusted.
Therefore, every formal task must include the conversation, meeting, report,
system suggestion, attachment, or source page that caused it to exist.

## Standard

| Item | Requirement |
| --- | --- |
| New formal task | Must include source evidence in the task body or source/evidence fields. |
| LINE-derived task | Include group, time, sender, content, and media/file reference when present. |
| Meeting-derived task | Include meeting page plus checkbox item, decision, or nearby discussion. |
| Status update | Append the source clue that caused the status/owner/date/next-step change. |
| Missing source | Do not create a confirmed formal task; use candidate/pending-confirmation or recover source. |
| User UI | Render evidence from task data; do not invent or decide source sufficiency. |

## Scope

Apply this package to each AM-style production project separately:

- HOZO_AM
- SevenAM

AMCore stores the shared rule and validation tool. Project data stays inside each
project.

## Definition Of Done

- AMCore `AGENTS.md` defines the source-evidence rule.
- AMCore judgment rules link to the source-evidence requirement.
- The hourly reconciliation contract contains a source-evidence gate.
- HOZO AM and SevenAM local hourly reconciliation configs contain the same gate.
- A validation tool checks generated task pages for source evidence sections.
- Project manifests and upgrade records record the install separately.
