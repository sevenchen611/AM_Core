# Verify

## Local

- Run a syntax check on the project-local meeting sync script.
- Dry-run meeting sync against a meeting page that contains at least one Notion to-do block.
- Dry-run meeting sync against a meeting page or field that contains at least one Markdown checkbox line.
- Confirm checkbox items appear in the extracted task list even when the text has no action keyword.
- Confirm checkbox items are marked as already confirmed when the project task schema supports confirmation status.
- Confirm running the same meeting sync again does not create duplicate tasks.

## Pass Criteria

- Checkbox meeting items enter task tracking directly.
- Non-checkbox lines still use the ordinary action-item judgment.
- No project uses another project's Notion data source, task records, meeting records, LINE records, or secrets.
- Project-local manifest and upgrade record reflect the actual install status.
