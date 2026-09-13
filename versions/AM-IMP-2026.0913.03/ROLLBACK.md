# Rollback

Revert the AMCore and Rental commits for this upgrade, then redeploy the reverted `main` commits.

Rollback restores the prior raw 401/403 response for expired direct links. It does not change or delete
SSO sessions, handoffs, claims, attachments, group bindings, or finance records.
