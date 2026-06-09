# AM-IMP-2026.0608.12 Cron Report Reliability Upgrade

This package standardizes how AM-style Render cron report jobs handle temporary web service failures.

It exists because the 2026-06-08 17:00 follow-up reports for HOZO AM and 7AM failed while the cron jobs were able to start. HOZO AM showed `Report push failed: 502 <!DOCTYPE html>`, which means Render returned a Bad Gateway HTML page before the control API could answer. 7AM showed a failed cron run without a successful outgoing report record, while health and preview checks were normal afterward. The shared conclusion is that the report sender needs retry and wake-up behavior around transient Render failures.

## What This Package Defines

- A retry policy for scheduled report sends.
- A health ping before report send, enabled by default.
- Retryable status handling for `408`, `429`, `500`, `502`, `503`, and `504`.
- Retryable handling for network and timeout failures.
- Structured attempt logs for started, failed, retrying, succeeded, and final failure states.
- Project-neutral configuration for HOZO AM and 7AM header/env prefixes.
- Failure alerts only after the final retry fails.

## Scope

This version defines and provides reusable cron reliability code. It does not contain Render secret values, LINE tokens, Notion tokens, customer messages, report records, or production database IDs.

Each production project must install the script into its own runtime and update its own Render Blueprint or Render cron environment.
