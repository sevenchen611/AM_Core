# Install — AM-IMP-2026.0828.04

1. Deploy the updated `core/drive.js` with the AM Platform runtime.
2. Keep the existing Google OAuth credentials and tenant Drive root IDs.
3. Do not add `anyone` or `domain` sharing to contract folders.
4. No database migration or new environment variable is required.
5. Run `node tools/dryrun-drive-privacy-audit.mjs` before deployment.

The change is code-only and does not move, rewrite, or delete existing Drive
files.
