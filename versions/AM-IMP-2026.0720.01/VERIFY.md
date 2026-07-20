# Verify

Run these checks in each project after installation:

1. Upload a meeting recording and provide attendee/topic information.
2. Confirm the meeting record appears in LINE and Notion.
3. Confirm formal tasks are not created immediately when the review link is available.
4. Open the review link and choose `不要，直接完成`; confirm tasks are created once.
5. Run a second meeting and choose `要，開啟確認`.
6. Edit a todo title, owner, and due date; confirm that todo returns to unconfirmed.
7. Try to finalize before all todos are confirmed; confirm the request is blocked.
8. Confirm every todo and finalize; confirm formal tasks are created once.
9. Confirm created tasks preserve meeting source and group binding when schema supports them.
10. Restart risk check: note that pending in-memory reviews do not survive service restart in this version.

AMCore checks:

```text
node tools/check-upgrade-package.js AM-IMP-2026.0720.01
node tools/audit-alignment.js
```
