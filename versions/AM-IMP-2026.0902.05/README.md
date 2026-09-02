# AM-IMP-2026.0902.05 - Returned-draft review resubmission recovery

A contract version may move from internal review back to draft and then be submitted again. The PostgreSQL adapter formerly retained the first review-submission timestamp and actor with `COALESCE`, while the management service correctly required evidence for the new submission. The second transition therefore committed but was reported as a failure.

This package replaces the stale review timestamp and actor on every valid draft-to-internal-review transition. The graphical workspace also reloads the authoritative contract state after a failed response and recognizes an already-committed target state, so the approval controls cannot remain hidden behind stale UI data.
