# Verify AM-IMP-2026.0612.04

## Verification Performed (from source record)

Success, failure (exit-code passthrough), and alert-skip paths tested locally; credit-exhaustion incident produced correct retry-and-recover behavior in production.

## Re-verification For A New Install

- `node --check` passes on any changed scripts.
- The target project shows the new behavior using its own data only.
- No values from another project appear in config, logs, or output.
