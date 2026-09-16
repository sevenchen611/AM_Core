# Rollback

1. Roll AM Platform back to the previous production commit so it stops sending the extended external-source contract.
2. Roll Rental back to the previous production commit after AM is stable.
3. Keep the additive external-template table; it is inert on the old code and preserves any user-created templates.
4. Do not delete claims or templates during rollback.

