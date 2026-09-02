# Install

1. Apply the signing-page and signing-page dry-run files listed in
   `upgrade.json`.
2. Run every command in `VERIFY.md`.
3. Deploy the Engineering AM service using its existing formal-signing
   configuration.
4. Open an active invitation as the designated signer and confirm the PDF
   review warning and large signature canvas are present.

No database migration or environment-variable change is required. Existing
active signing links use the updated page automatically and do not need to be
reissued.
