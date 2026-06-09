# Environment

This package uses variable names only. Never store secret values in AMCore.

| Variable | Required | Scope | Notes |
| --- | --- | --- | --- |
| `CONTROL_API_URL` | Yes | Cron job | Report send endpoint, usually `/control/reports/send`. |
| `CONTROL_LINE_PUSH_URL` | Yes for alerts | Cron job | Alert push endpoint, usually `/control/line/push`. |
| `CONTROL_HEALTH_URL` | Optional | Cron job | Health endpoint. If omitted, derived as `/control/health` from `CONTROL_API_URL`. |
| `AM_PROJECT_ENV_PREFIX` | Recommended | Cron job | `HOZO` or `SEVEN`. |
| `AM_CONTROL_HEADER_PREFIX` | Recommended | Cron job | `hozo` or `seven`. |
| `AM_CONTROL_API_KEY` | Optional | Cron job | Generic key name. Prefer project-local key names in production. |
| `HOZO_CONTROL_API_KEY` | HOZO only | Cron job | HOZO AM project-local secret. |
| `SEVEN_CONTROL_API_KEY` | 7AM only | Cron job | 7AM project-local secret. |
| `AM_CRON_RETRY_DELAYS_MS` | Recommended | Cron job | Default `10000,30000,60000`. |
| `AM_CRON_REQUEST_TIMEOUT_MS` | Recommended | Cron job | Default `45000`. |
| `AM_CRON_HEALTH_PING_ENABLED` | Recommended | Cron job | Default `true`. |
| `AM_CRON_ALERTS_ENABLED` | Recommended | Cron job | Default `true`. |

Project-specific alert display names may stay in project code, for example `HOZO_OUTGOING_ACTOR_NAME`.
