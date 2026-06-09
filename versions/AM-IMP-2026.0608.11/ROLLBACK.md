# Roll Back AM-IMP-2026.0608.11

This package is primarily a standard and schema contract.

## Safe Rollback

1. Hide or disable the six action buttons in report UI.
2. Keep existing decision fields in Notion if any controller decisions have already been recorded.
3. Stop writing new action keys from reports or LINE commands.
4. Leave already-created tasks, progress reports, and owner-goal requests untouched unless a project owner explicitly asks to review them.

## Do Not Delete By Default

Do not delete these fields if they contain decisions:

- `介入狀態`
- `介入動作`
- `修正後總控專案`
- `指定專案目標`
- `指定任務目標`
- `要求口述目標對象`
- `控制者備註`
- `結果任務`

Archive or hide them only after confirming they are no longer needed.

