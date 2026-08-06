# Rollback

1. Disable the AM Calendar integration by removing `HOZO_RENTAL_CALENDAR_MACHINE_TOKEN` or disabling the package's `綁定` command deployment.
2. Keep the previously deployed `personal-assistant` identity confirmation and group routing enabled.
3. Revoke any test identity links from the Rental Portal or an owner-only maintenance operation.
4. Do not delete additive Calendar tables or audit logs; they are needed for recovery and later Phase 2 work.
5. Use a revert PR for code rollback. Never reset or force-push `main`.
