# AM-IMP-2026.0830.01 — Engineering draft-review status hotfix

Status: Deployed

The LINE provider accepted the first invitation, but the post-send database update failed because a joined PostgreSQL statement used an unqualified `status` column. The same defect prevented the public page from recording an open and loading the draft bundle.

The runtime fix qualifies the review row fields, adds regression coverage, and permits evidence-based recovery of the accepted invitation without sending a duplicate LINE message.

## Production verification

- PR #42 merged as `9edb718` and the Render service reported the deployment live.
- The existing HZ-CT-001 V1 review was restored to `sent` using its original LINE provider acceptance timestamp and message evidence.
- The Engineering AM contract workspace displays `LINE 已接受發送` for the recovered review.
- The production PostgreSQL open-transition statement parsed and executed successfully in a transaction that was rolled back without changing a review.
- No second LINE invitation was sent.
