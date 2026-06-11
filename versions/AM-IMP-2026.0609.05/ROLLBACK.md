# Rollback

To roll back UI behavior, restore the previous project-local `scripts/build-user-ui-connected-preview.js` and `src/control-api.js` from version control.

The added Notion fields can remain in place safely:

- `期限依據`
- `下次追蹤日`
- `逾期狀態`

Do not delete deadline values from production tasks during rollback unless the project owner explicitly asks for that data removal.
