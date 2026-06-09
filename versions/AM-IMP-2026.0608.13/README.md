# AM-IMP-2026.0608.13 Judgment Calibration Knowledge Base

This package standardizes how AM-style projects send uncertain task judgments to the controller, receive LINE feedback, update the project-local task record, and extract reusable judgment rules.

It exists to improve assistant decision accuracy over time without mixing HOZO AM and 7AM data.

## What This Package Defines

- A controller review workflow for uncertain total-control tasks.
- A LINE message format for judgment review.
- A controller reply format that can update the source task.
- Start, pause, and status command words for LINE-driven calibration sessions.
- Progress labels such as `2/80`, plus calibrated and remaining counts.
- Project-local Notion schema templates for calibration cases and judgment rules.
- A durable AMCore knowledge-base document for anonymized shared rules.
- Verification and rollback steps.

## Scope

AMCore stores the process, schema, templates, and anonymized judgment rules only.

Each target project stores its own live tasks, LINE replies, Notion page IDs, LINE target IDs, customer messages, and operational records.

## Applies To

- HOZO_AM
- SEVEN_AM
- Future AM projects

## What This Package Must Install

- Code changes: optional project-local glue to select review candidates and call the existing LINE push path.
- LINE commands: start, pause, status, and controller reply handling.
- Scripts: existing project `scripts/line-push.js` or equivalent project-local sender.
- Notion database schemas: judgment calibration cases and judgment rules.
- Environment variable definitions: project-local LINE push/control settings only.
- Documentation: project-local upgrade record and manifest row.
- Verification checks: dry-run review, LINE send test, reply update test, rule extraction test.

## Data Separation

This package may share schema, message templates, and generalized rules.

This package must not share project data, database IDs, LINE targets, tokens, Render secrets, customer records, task records, report records, message records, or attachment records.
