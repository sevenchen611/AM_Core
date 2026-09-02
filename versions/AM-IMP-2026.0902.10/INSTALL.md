# Install

1. Apply the signing-page and signing-page dry-run files listed in
   `upgrade.json` to the Engineering AM runtime.
2. Run every command in `VERIFY.md`.
3. Deploy the Engineering AM service using its existing signing configuration.
4. Open a current invitation from the bound LINE group and complete LINE Login.
5. Confirm the designated signer reaches the signing controls and a different
   current group member reaches read-only contract access without another login
   redirect.

No database migration, environment-variable change, invitation reissue, or
stored-contract mutation is required. Existing active signing links use the
corrected page after deployment.
