# AM User UI Architecture

`User UI` is the AM user-facing web interface module.

It is separate from the production LINE bot runtime. AMCore owns the shared UI
specification, templates, generators, installation package, and verification
rules. Each child project, such as HOZO_AM or SevenAM, owns its own generated UI
data, project-local configuration, Notion database IDs, LINE records, tasks,
meetings, and attachments.

## Purpose

User UI gives project users a faster HTML entry point for data that normally
lives in Notion.

The first User UI surfaces are:

- Project overview.
- All projects and their supporting tasks.
- All task records.
- LINE groups, recent messages, and attachments.
- Meeting records.
- Progress and daily reports.
- AM Core judgment rules.
- Project-specific judgment rules.
- Judgment calibration cases.
- Environment data with secrets masked.
- Available AMCore upgrade versions.
- Developer settings for Admin users.

## Access Model

User UI must distinguish project users from Admin users.

- Project users only see their own project data.
- Admin users can view and configure all projects.
- Secrets such as LINE tokens, Notion tokens, channel secrets, API keys, and
  passwords must be masked by default.
- Any future secret reveal action must require Admin permission and audit logs.

## Data Boundary

AMCore may store:

- User UI templates.
- User UI generators.
- Shared layout and schema specifications.
- Installation and verification instructions.

AMCore must not store:

- Project `.env` values.
- Token or secret values.
- Live LINE messages.
- Live task records.
- Live meeting records.
- Production Notion database IDs as required shared values.

Connected previews should be generated inside the child project folder, not in
AMCore.

## Current Files

- Shared prototype:
  `D:\Codex_project\AM_Core\docs\AM_SUBPROJECT_PORTAL_PROTOTYPE.html`
- Connected preview generator:
  `D:\Codex_project\AM_Core\tools\build-user-ui-connected-preview.js`
- SevenAM generated preview:
  `D:\Codex_project\SevenAM\line-oa-webhook\docs\user-ui-connected-preview.html`

## Generator

Example:

```text
node D:\Codex_project\AM_Core\tools\build-user-ui-connected-preview.js --project-root D:\Codex_project\SevenAM\line-oa-webhook --name SevenAM --output D:\Codex_project\SevenAM\line-oa-webhook\docs\user-ui-connected-preview.html
```

The generator reads the project-local `.env`, queries the configured Notion data
sources, masks secrets, and writes a static HTML preview inside the child
project.
