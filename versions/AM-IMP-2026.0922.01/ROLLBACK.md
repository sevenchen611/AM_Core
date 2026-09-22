# Rollback

Revert the AM Platform runtime commit through a reviewed pull request and let the
production service deploy the prior `main` revision. Then revert the coordinated
Rental sender if necessary.

No schema rollback is required. Existing notification outbox rows remain durable
for a later compatible retry; do not delete or rewrite claim, LINE recipient, or
delivery evidence.
