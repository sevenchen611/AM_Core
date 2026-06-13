# Verify AM-IMP-2026.0612.06

## Verification Performed (from source record)

Stats loading verified against live case data; eval guarded until enough labeled cases.

## Re-verification For A New Install

- `node --check` passes on any changed scripts.
- The target project shows the new behavior using its own data only.
- No values from another project appear in config, logs, or output.
