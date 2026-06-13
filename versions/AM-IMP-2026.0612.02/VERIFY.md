# Verify AM-IMP-2026.0612.02

## Verification Performed (from source record)

Production cron created real high-quality tasks; legacy fallback dry-run verified.

## Re-verification For A New Install

- `node --check` passes on any changed scripts.
- The target project shows the new behavior using its own data only.
- No values from another project appear in config, logs, or output.
