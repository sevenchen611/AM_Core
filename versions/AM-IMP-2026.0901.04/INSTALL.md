# Install

1. Apply the runtime changes to `modules/claims/v3/receiver.js` and `modules/claims/v3/group-entry.js`.
2. Keep `MAX_SOURCE_HINT_AGE_SECONDS` and `MAX_ENTRY_LIFETIME_MS` at ten minutes.
3. Run `node --check` for both runtime files.
4. Run `npm run dryrun:finance-v3-direct`.
5. Merge through a pull request and let Render deploy GitHub `main`.

No environment or database change is required.
