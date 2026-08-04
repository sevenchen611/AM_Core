# Install

1. Deploy the compatible Rental claim receipt response first.
2. Install the AM claims notification update.
3. Keep the existing Rental claims and event machine tokens unchanged.
4. Confirm the assigned reviewer has an active Rental account, claims approval permission,
   and a LINE user ID in `finance_claim_permissions`.
5. Deploy AM only after `node tools/dryrun-claims.mjs` passes.

Older Rental responses remain compatible; AM will still send the detailed summary but will
omit the real mention when reviewer identity data is unavailable.
