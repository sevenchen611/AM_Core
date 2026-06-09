# AM-IMP-2026.0608.19 Total-Control Task Table Source Text Hide Rule

This package standardizes the default table display for project-local total-control task databases.

## Purpose

The `來源原文` property can be useful as a legacy source field, but it is too long for everyday task control table headers.

Because task evidence is now recorded inside each task page body, the default total-control task table should hide `來源原文` while preserving the property and its existing data.

## Included Rule

Layout key:

```text
total_control_tasks.default_table
```

Default view behavior:

- Keep the project's useful task-control columns.
- Hide `來源原文` from the table header.
- Do not delete the property.
- Do not erase existing source text.

## Data Separation

This package may share display rules and property names.

This package must not share Notion tokens, project data source IDs as required shared values, customer records, task records, report records, message records, or attachment records.
