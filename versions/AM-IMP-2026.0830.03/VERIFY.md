# Verify

- Run `npm run dryrun:contract-review`.
- Run `node tools/dryrun-engineering-contract-workspace.mjs`.
- Confirm a completed public review displays reviewer, decision, full notes, and response time.
- Confirm Engineering AM displays the full notes and `依此意見建立下一版本` for a change request.
- Confirm saving the next version writes `snapshot.revisionSource` and does not change the reviewed version.
