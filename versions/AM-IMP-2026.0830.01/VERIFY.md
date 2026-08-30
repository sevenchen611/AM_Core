# Verify

- `node tools/dryrun-engineering-contract-store.mjs`
- `npm run dryrun:contract-review`
- Confirm the original public review URL returns the draft content.
- Confirm the review moves from `sent` to `opened` and records one open event.
- Confirm no duplicate LINE invitation was sent during repair.
