# Verify AM-IMP-2026.0612.07

## Verification Performed (from source record)

Assembled prompt reviewed end-to-end; full pipeline smoke-tested to the API boundary.

## Re-verification For A New Install

- `node --check` passes on any changed scripts.
- The target project shows the new behavior using its own data only.
- No values from another project appear in config, logs, or output.
