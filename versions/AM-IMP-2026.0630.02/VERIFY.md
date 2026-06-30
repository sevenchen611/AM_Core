# Verify AM-IMP-2026.0630.02

## Verification Performed (from source record)

`node --check` passes. Live test against a real parsed image: matched the image
block by message id, inserted a test block — confirmed it landed at image index+1
(directly below the image) — then deleted the test block. No residue.

## Re-verification For A New Install

- `node --check` passes on any changed scripts.
- The target project shows the new behavior using its own data only.
- No values from another project appear in config, logs, or output.
