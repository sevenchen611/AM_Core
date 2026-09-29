# Rollback

Stop the application's personal LINE worker and public trial tunnel first. Disable `AMCORE_LINE_BINDINGS_ENABLED`, remove only the new management client and its secret, and restore the target client's prior configuration. Redeploy the previously verified root commit. Preserve the existing IO key, directory key, static group configuration and single OA webhook.

Retain the deployment-owned schema and encrypted application state for investigation/recovery; do not drop tables or copy live rows into AMCore. Feature-disabled health returns the previous 1.2.0 contract. Inactive bindings must never be treated as authorization by the application. Re-enable only after restoring the matching reviewed runtime and management contract.
