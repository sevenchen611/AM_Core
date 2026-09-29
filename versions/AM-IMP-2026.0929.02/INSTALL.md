# Install

1. Install the base gateway package AM-IMP-2026.0929.01 first. No new database schema, credential or environment configuration is required for this extension.
2. Apply `core/line-io/index.js` recipient handling and the optional member-lookup timeout in `core/line.js`, preserving unrelated production changes. Update the OpenAPI contract and client example.
3. Run VERIFY.md. Review, merge and push the production changes to GitHub main before Render deployment.
4. Update callers to supply `notifyUserId` in the JSON request, or `notify_user_id` in the Python client. Preserve the same body and key on retries; new recipients require a new key.
5. Keep actual group/user IDs, key and provider receipts in each caller's own configuration. Copy the current contract and example into its handoff location.
6. Verify the production version and a canary in the owner's specified group, including replay and recipient conflict. Update the actual tenant manifest and upgrade record to Deployed only after production verification. Other projects remain uninstalled.
