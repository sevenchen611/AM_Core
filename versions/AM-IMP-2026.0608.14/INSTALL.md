# Install

Install this package inside each target project separately.

1. Update the project-local meeting sync script that reads meeting pages and creates task records.
2. Preserve checkbox markers when reading Notion `to_do` blocks.
3. Treat Markdown checkbox lines such as `[ ] item`, `[x] item`, `□ item`, `☐ item`, `☑ item`, and `✅ item` as meeting tasks.
4. Let checkbox-derived tasks bypass the ordinary action-keyword filter.
5. When the task database has a confirmation field, write checkbox-derived tasks as `已確認`.
6. Keep the source as `會議` and include the meeting reference in the source excerpt.
7. Keep duplicate prevention project-local by matching meeting reference plus task text.
8. Update the project-local manifest and create a project-local upgrade record only after verification.

Do not copy meeting records, task records, Notion page IDs, database IDs, LINE records, or environment values between projects.
