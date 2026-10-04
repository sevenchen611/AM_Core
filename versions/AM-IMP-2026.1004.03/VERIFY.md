# Verify

Run `npm run dryrun:claims-authority`, `node --test tools/test-claims-form-availability.mjs tools/test-mobile-claim-form.mjs`, and the package check. Verify repeat schema execution, unchanged old rows, internal-only publication, expired/denied/disabled session rejection, and no V3 identity call for this form. Check the new card and login-required mobile preview on production without sending a test claim.
