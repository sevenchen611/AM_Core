# Install

1. Deploy the runtime, signing page, artifact client, PDF renderer, and
   construction route files listed in `upgrade.json` together.
2. No database migration, environment-variable change, or signer reassignment
   is required.
3. Existing valid sessions with a completed individual Party A signature begin
   serving the staged PDF automatically on their next protected document load.
4. Keep the existing signing kill switch and Drive privacy checks enabled.

