# Reference Patch Notes

Apply these behavior changes to each project's meeting sync script:

- When reading Notion blocks, convert `to_do` blocks into checkbox-prefixed text before extraction.
- Detect checkbox-prefixed lines before normalizing line text.
- If the source line is a checkbox, add it to extracted meeting action items even when it does not match action keywords.
- Carry the source type into task creation as `meeting-checkbox`.
- For `meeting-checkbox` items, write confirmation status as `已確認` when the task database supports it.
- Keep non-checkbox action item extraction unchanged.

The AMCore runtime template contains a reference implementation in `core/runtime-template/scripts/scripts/sync-meeting-actions.js`.
