# Install

Install this package separately in HOZO AM and 7AM.

## 1. Update The Report Cron Script

Copy the shared script pattern from:

```text
D:\Codex_project\AM_Core\versions\AM-IMP-2026.0608.12\scripts\render-cron-report.js
```

to the target project's:

```text
scripts\render-cron-report.js
```

Keep project-specific fallback URLs or actor display names only inside the target project.

## 2. Configure Project Prefixes

For HOZO AM cron jobs:

```text
AM_PROJECT_ENV_PREFIX=HOZO
AM_CONTROL_HEADER_PREFIX=hozo
```

For 7AM cron jobs:

```text
AM_PROJECT_ENV_PREFIX=SEVEN
AM_CONTROL_HEADER_PREFIX=seven
```

The script may infer these from `HOZO_CONTROL_API_KEY` or `SEVEN_CONTROL_API_KEY`, but Render cron jobs should set them explicitly.

## 3. Configure Retry And Health Ping

Recommended shared defaults:

```text
AM_CRON_RETRY_DELAYS_MS=10000,30000,60000
AM_CRON_REQUEST_TIMEOUT_MS=45000
AM_CRON_HEALTH_PING_ENABLED=true
AM_CRON_ALERTS_ENABLED=true
```

`CONTROL_HEALTH_URL` is optional. If it is not set, the script derives `/control/health` from `CONTROL_API_URL`.

## 4. Keep Project Secrets Local

Each project must continue using its own control key:

- HOZO AM: `HOZO_CONTROL_API_KEY`
- 7AM: `SEVEN_CONTROL_API_KEY`

Do not copy either value into AMCore or into the other project.

## 5. Update Project Records

After installation in each project:

1. Update `docs/project-improvement-manifest.md`.
2. Create a project-local record under `docs/upgrades/`.
3. Mark the status `Installed` only after local verification passes.
4. Mark the status `Deployed` only after Render production cron behavior is verified.
