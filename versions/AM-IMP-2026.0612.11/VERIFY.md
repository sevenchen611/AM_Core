# Verify AM-IMP-2026.0612.11

## Verification Performed (from source record)

Production heartbeat verified (workerActive:true); first subscription-quota cycle created a real task; auth-failure standby behavior verified.

## Re-verification For A New Install

- `node --check` passes on any changed scripts.
- The target project shows the new behavior using its own data only.
- No values from another project appear in config, logs, or output.
