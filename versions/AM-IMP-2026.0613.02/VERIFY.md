# Verify AM-IMP-2026.0613.02

## Verification Performed (from source record)

Both workers restarted under the new wrapper: self-tests logged within seconds (HOZO codex 17s, SevenAM claude-code ~8s) and the operating-hours gate engaged; under Tee-Object the same workers produced no log output for 8+ minutes.

## Re-verification For A New Install

- `node --check` passes on any changed scripts.
- The target project shows the new behavior using its own data only.
- No values from another project appear in config, logs, or output.
