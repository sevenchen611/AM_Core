# Verify AM-IMP-2026.0612.16

## Verification Performed (from source record)

Both projects verified clean after the split (each lists only its own tasks); rule visible to the extraction prompt loader.

## Re-verification For A New Install

- `node --check` passes on any changed scripts.
- The target project shows the new behavior using its own data only.
- No values from another project appear in config, logs, or output.
