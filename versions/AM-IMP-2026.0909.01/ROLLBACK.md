# Rollback

1. Disable the Rental caller's automatic finance notification before removing
   the required-mention contract, so failures remain visible rather than being
   mistaken for successful plain-text notices.
2. Revert the AM Platform module commit and redeploy through the normal reviewed
   production workflow.
3. Preserve the finance group binding and its member map; they are shared
   routing data and are not created by this package.
4. Preserve Rental notification-attempt records for reconciliation.

Rollback must not introduce a caller-controlled LINE group id or user id and
must not silently downgrade required reviewer mentions to plain text.
