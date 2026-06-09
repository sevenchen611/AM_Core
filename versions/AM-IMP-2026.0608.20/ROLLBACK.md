# Rollback

1. Revert the SevenAM report generator change that adds `calendar`.
2. Remove Calendar input variables from SevenAM `.env.example`.
3. Update SevenAM manifest status.

No Calendar event data restore is required because this package does not store Calendar records.
