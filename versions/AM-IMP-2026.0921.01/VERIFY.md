# Verify

Run:

```text
npm run dryrun:contract-identity-attachments
node tools/dryrun-engineering-contract-completion.mjs
node tools/dryrun-engineering-contract-workflow-api.mjs
node tools/dryrun-engineering-contract-management.mjs
npm run check
node tools/check-upgrade-package.js AM-IMP-2026.0921.01
```

Confirm in an authenticated internal workspace:

- a completed contract shows separate front/back identity-card links next to the final signed PDF;
- each link returns the original clear JPEG/PNG only after view permission, tenant/project scope, completed-session, private-Drive and SHA-256 checks;
- an existing completed contract works without re-signing or re-uploading;
- responses use `Cache-Control: private, no-store`;
- no raw Drive id, public URL, identity image or LINE message is exposed by JSON;
- opening the links performs no contract mutation.
