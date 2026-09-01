# Install

1. Apply the runtime change to `modules/claims/v3/receiver.js`.
2. Keep final `claim_web_entry` validation tied to `MAX_SOURCE_HINT_AGE_SECONDS`.
3. Run `node --check modules/claims/v3/receiver.js`.
4. Run `npm run dryrun:finance-v3-direct`.
5. Merge through a pull request and let Render deploy GitHub `main`.

No environment or database change is required.
