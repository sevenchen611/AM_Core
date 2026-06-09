# Install

1. Read `D:\Codex_project\AM_Core\config\notion-view-layouts.json`.
2. Identify the current project's LINE group options database.
3. Identify the current project's responsibility database.
4. If `候選來源權責項目` is missing, add it as a relation to the current project's responsibility database.
5. Update the LINE group options `Default view` table display to show only:
   - `總控專案`
   - `群組顯示名稱`
   - `LINE對話名稱`
   - `候選來源權責項目`
6. Keep project-specific Notion IDs and access values out of AMCore files.
7. Verify the view display order after applying the layout.
