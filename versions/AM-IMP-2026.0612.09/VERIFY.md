# Verify AM-IMP-2026.0612.09

## Verification Performed (from source record)

Vocabulary injection verified in prompt; signal loading verified against live data; section live in production.

## Re-verification For A New Install

- `node --check` passes on any changed scripts.
- The target project shows the new behavior using its own data only.
- No values from another project appear in config, logs, or output.
