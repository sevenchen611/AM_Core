# Notion Database View Layouts

This file records shared Notion database view layouts for AM-style projects.

The layout registry is stored in:

```text
D:\Codex_project\AM_Core\config\notion-view-layouts.json
```

## Rules

- Store logical database roles, view names, and property order only.
- Do not store Notion tokens, project secrets, customer records, or live task/report/message data.
- Do not require project-specific data source IDs as shared values.
- Apply layouts separately in each project using that project's own Notion workspace access.
- If a required property is missing, create it inside the current project's own Notion database only.

## LINE Group Options Default Table

Layout key:

```text
line_group_options.default_table
```

Applies to:

- `HOZO_AM`
- `SEVEN_AM`

View:

```text
Default view
```

Visible property order:

| Order | Property |
| ---: | --- |
| 1 | `總控專案` |
| 2 | `群組顯示名稱` |
| 3 | `LINE對話名稱` |
| 4 | `候選來源權責項目` |

Definition:

The listed properties are the only visible table columns and must appear in this order.

Project note:

If `候選來源權責項目` does not exist in a project's LINE group options database, add it as a relation to that same project's responsibility database. Do not relate it to another project's responsibility database.

## Total-Control Tasks Default Table

Layout key:

```text
total_control_tasks.default_table
```

Applies to:

- `HOZO_AM`
- `SEVEN_AM`

View:

```text
Default view
```

Hidden property:

| Property | Rule |
| --- | --- |
| `來源原文` | Do not show in the default table header. |

Definition:

The project may keep its existing useful task-control columns, but `來源原文` should not be displayed in the default table header.

Reason:

Task source evidence and source text should now be kept in the task page body. Keeping `來源原文` visible in the table makes the task database harder to scan.

Project note:

Keep the `來源原文` property available for backward compatibility and audit fallback. Do not delete the property or erase existing values unless the project owner explicitly approves data removal.
