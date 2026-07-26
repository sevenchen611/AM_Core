# AM-IMP-2026.0726.01 - Engineering reminder deep links

Engineering task and feedback-ticket reminders now include a direct AM Platform dashboard link when the tenant has a public base URL configured. The link opens the tenant dashboard and loads the referenced Notion page in the existing editable document modal.

This package applies to AM Platform tenants that use the construction dashboard, reminders, and tasks modules. It does not create, copy, or expose project data, LINE IDs, Notion database IDs, Render secrets, or customer records.

## Scope

- Add `開啟任務:` links to task due, overdue, and escalation reminders.
- Add `開啟單據:` links to feedback-ticket due, overdue, and escalation reminders.
- Support `/dashboard?tenant=<tenant-key>&doc=<page-id>` so the dashboard opens the referenced page directly.
- Use the tenant public base URL from `<PREFIX>_PUBLIC_BASE_URL`, falling back to `AMCORE_PUBLIC_BASE_URL`.

## Data Isolation

The URL contains only the target tenant key and the target page id. Loading and editing the page still goes through AM Platform Portal authorization and the tenant-locked Notion guard.
