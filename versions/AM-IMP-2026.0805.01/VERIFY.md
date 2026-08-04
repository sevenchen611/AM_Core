# Verify

1. Run `node tools/dryrun-claims.mjs`.
2. Run `node tools/verify-line-push-timeout.mjs`.
3. Run `npm run check` and `npm run dryrun`.
4. Submit a test claim from an enabled group.
5. Confirm the first LINE message contains every submitted field and a real mention of the
   assigned reviewer.
6. Open the review link and confirm the matching claim is selected in Rental finance.
