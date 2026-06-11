# Project Document Database

This is the human-readable index for AMCore project explanation documents.

The machine-readable registry is stored at:

```text
D:\Codex_project\AM_Core\config\project-document-database.json
```

## Rules

- Add every durable project explanation document to the registry.
- Store only metadata and relative file paths.
- Do not store tokens, secrets, customer messages, task records, report records, attachment records, or automation logs.
- Keep project-specific production values in each project, not in AMCore.

## Documents

| ID | Title | File | Category | Format | Status |
| --- | --- | --- | --- | --- | --- |
| `amcore-readme` | AM_Core project overview | `README.md` | Project overview | Markdown | Active |
| `architecture-split-plan` | AM Core architecture split plan | `docs/ARCHITECTURE_SPLIT_PLAN.md` | Architecture | Markdown | Active |
| `standardization-rules` | AM project standardization rules | `docs/STANDARDIZATION_RULES.md` | Governance | Markdown | Active |
| `upgrade-package-standard` | Upgrade package standard | `docs/UPGRADE_PACKAGE_STANDARD.md` | Upgrade governance | Markdown | Active |
| `install-version-workflow` | Install version workflow | `docs/INSTALL_VERSION_WORKFLOW.md` | Upgrade governance | Markdown | Active |
| `current-version-matrix` | Current version matrix | `docs/CURRENT_VERSION_MATRIX.md` | Status | Markdown | Active |
| `notion-database-view-layouts` | Notion database view layouts | `docs/NOTION_DATABASE_VIEW_LAYOUTS.md` | Notion governance | Markdown | Active |
| `line-message-group-registration-flow` | LINE new group and message registration flow | `docs/LINE_MESSAGE_GROUP_REGISTRATION_FLOW.html` | Process explainer | HTML | Active |
| `total-control-task-classification-flow` | Total control task classification and project assignment flow | `docs/TOTAL_CONTROL_TASK_CLASSIFICATION_FLOW.html` | Process explainer | HTML | Draft |
| `report-intervention-action-standard` | Report intervention action standard | `docs/REPORT_INTERVENTION_ACTION_STANDARD.md` | Reporting governance | Markdown | Active |
| `report-slot-rules` | AM 各時段報告規則 | `docs/REPORT_SLOT_RULES.md` | Reporting governance | Markdown | Active |
| `task-next-step-decision-rules` | AM 任務下一步判斷規則 | `docs/TASK_NEXT_STEP_DECISION_RULES.md` | Task control governance | Markdown | Active |
| `task-judgment-rule-loading-standard` | AM 任務判斷規則載入標準 | `docs/TASK_JUDGMENT_RULE_LOADING_STANDARD.md` | Task control governance | Markdown | Active |
| `line-conversation-rendering-standard` | User UI LINE 對話引用呈現標準 | `docs/LINE_CONVERSATION_RENDERING_STANDARD.md` | User UI governance | Markdown | Active |
| `report-0800-daily-intervention-form-prototype` | 08:30 daily report intervention form prototype | `docs/REPORT_0800_DAILY_INTERVENTION_FORM_PROTOTYPE.html` | Reporting prototype | HTML | Draft |
| `judgment-calibration-knowledge-base` | Judgment calibration knowledge base | `docs/JUDGMENT_CALIBRATION_KNOWLEDGE_BASE.md` | Governance | Markdown | Active |
| `meeting-checkbox-task-standard` | Meeting checkbox task standard | `docs/MEETING_CHECKBOX_TASK_STANDARD.md` | Task governance | Markdown | Active |
| `total-control-task-title-rules` | Total-control task title rules | `docs/TOTAL_CONTROL_TASK_TITLE_RULES.md` | Task governance | Markdown | Active |

## Current Featured Explainer

Open this file in a browser to see the visual flow for new LINE groups and messages:

```text
D:\Codex_project\AM_Core\docs\LINE_MESSAGE_GROUP_REGISTRATION_FLOW.html
```

Open this draft flowchart to review how incoming messages become total control tasks:

```text
D:\Codex_project\AM_Core\docs\TOTAL_CONTROL_TASK_CLASSIFICATION_FLOW.html
```

Open this standard to review the controller actions every report candidate should provide:

```text
D:\Codex_project\AM_Core\docs\REPORT_INTERVENTION_ACTION_STANDARD.md
```

Open this draft prototype to review the 08:30 daily report intervention form:

```text
D:\Codex_project\AM_Core\docs\REPORT_0800_DAILY_INTERVENTION_FORM_PROTOTYPE.html
```

Open this governance document to review how assistant task judgments should be sent to the controller, corrected, and turned into reusable judgment rules:

```text
D:\Codex_project\AM_Core\docs\JUDGMENT_CALIBRATION_KNOWLEDGE_BASE.md
```

Open this standard to review how meeting-record checkbox items become confirmed project-local tasks:

```text
D:\Codex_project\AM_Core\docs\MEETING_CHECKBOX_TASK_STANDARD.md
```

Open this standard to review total-control task title writing rules:

```text
D:\Codex_project\AM_Core\docs\TOTAL_CONTROL_TASK_TITLE_RULES.md
```

## Update Checklist

When adding a new project explanation document:

1. Put the durable file under `docs/` unless another folder is more appropriate.
2. Add one entry to `config/project-document-database.json`.
3. Add one row to this file.
4. If the document defines a reusable project behavior, create or update an `AM-IMP-*` package.
