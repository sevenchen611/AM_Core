# Roll Back AM-IMP-2026.0608.15

Rollback is usually not recommended because this upgrade only improves human-readable titles.

If needed:

1. Revert the script changes in `scripts\sync-line-message-judgements.js`.
2. Stop using `scripts\clean-total-control-task-titles.js`.
3. Do not restore technical IDs into task titles unless the controller explicitly requests it.

Traceability remains available through source fields and Notion URLs.

