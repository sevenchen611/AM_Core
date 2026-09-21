# Verify

- Run `npm run dryrun:claims-authority`.
- Run `node tools/dryrun-claims.mjs`.
- Run `npm run check`.
- Confirm an external authority selection creates its legacy binding without invoking the Notion loader.
- Confirm an internal authority selection still invokes the live Notion group lookup.
- Confirm both `請款` and `費用申請` are claims-authority commands.
- Confirm production health returns HTTP 200 after deployment.
- Confirm a real external applicant can open the assigned form from a newly created selector.

Do not create a synthetic production financial claim for deployment verification.
