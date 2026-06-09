# Verify

Run these checks in each target project after installation.

## Local Checks

```text
node --check scripts/render-cron-report.js
```

Run a safe cron report preview/send test only against the current project's own Render service and control key.

## Failure Simulation

Temporarily point `CONTROL_API_URL` to an endpoint that returns a retryable status such as `502` or `503`.

Expected result:

- The script logs `attempt-started`.
- The script logs `attempt-failed`.
- The script waits according to `AM_CRON_RETRY_DELAYS_MS`.
- The script sends the final failure alert only after all attempts fail.

## Recovery Simulation

Temporarily point `CONTROL_API_URL` to a test endpoint that fails once and then succeeds.

Expected result:

- The first attempt fails.
- A later attempt succeeds.
- The cron process exits successfully.
- No final failure alert is sent.

## Production Verification

After Render Blueprint sync and deploy:

1. Confirm each report cron job has the correct project prefix env values.
2. Confirm `/control/health` responds before the report send.
3. Confirm the next scheduled report creates a project-local outgoing report record.
4. Confirm Render logs contain the shared structured attempt events.
5. Confirm no data or secret value from the other project appears in logs or records.
