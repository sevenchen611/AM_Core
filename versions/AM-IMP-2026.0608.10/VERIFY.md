# Verify

- Confirm `config/notion-view-layouts.json` includes `line_group_options.default_table`.
- Confirm the target project's LINE group options `Default view` is a table view.
- Confirm the visible property order is:
  1. `總控專案`
  2. `群組顯示名稱`
  3. `LINE對話名稱`
  4. `候選來源權責項目`
- Confirm no project secrets or live records were stored in AMCore.
- Run package completeness check:

```text
node D:\Codex_project\AM_Core\tools\check-upgrade-package.js AM-IMP-2026.0608.10
```
