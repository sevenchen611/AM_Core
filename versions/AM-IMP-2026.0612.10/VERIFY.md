# Verify AM-IMP-2026.0612.10

## Verification Performed (from source record)

7 real attachments parsed in production including a signed contract PDF with accurate party/term extraction.

## Re-verification For A New Install

- `node --check` passes on any changed scripts.
- The target project shows the new behavior using its own data only.
- No values from another project appear in config, logs, or output.
