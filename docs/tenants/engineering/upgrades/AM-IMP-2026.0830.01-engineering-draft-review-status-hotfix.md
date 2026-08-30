# AM-IMP-2026.0830.01 — Engineering draft-review status hotfix

Status: Ready

The LINE provider accepted the first invitation, but the post-send database update failed because a joined PostgreSQL statement used an unqualified `status` column. The same defect prevented the public page from recording an open and loading the draft bundle.

The runtime fix qualifies the review row fields, adds regression coverage, and permits evidence-based recovery of the accepted invitation without sending a duplicate LINE message.
