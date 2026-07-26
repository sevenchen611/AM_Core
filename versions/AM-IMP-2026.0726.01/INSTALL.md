# Install

## Target

Install into AM Platform for tenants using:

- `modules/reminders`
- `modules/construction`
- `modules/tasks`

The engineering tenant is the production target for this package.

## Code Changes

1. Update `modules/reminders/index.js` to build tenant dashboard document URLs and include them in task reminders and escalation messages.
2. Update `modules/construction/reminders.js` to include dashboard document URLs in feedback-ticket reminders and escalation messages.
3. Update `modules/construction/index.js` to pass the tenant public base URL to construction reminder passes.
4. Update `modules/construction/dashboard.js` to accept `doc=<page-id>` and auto-open that page in the existing dashboard document modal.

## Environment

No new environment variables are required.

Confirm the production engineering tenant has either:

```text
ENG_PUBLIC_BASE_URL=https://am.hozorental.com
```

or a valid:

```text
AMCORE_PUBLIC_BASE_URL=https://am.hozorental.com
```

If no public base URL is configured, reminders continue to send without a deep link.

## Deployment

1. Run local verification from `VERIFY.md`.
2. Commit only the package files and related AM Platform code changes.
3. Push to the AM_Core repository branch that Render tracks.
4. Wait for the AM Platform Render web service to deploy.
5. Verify `/health` and a dashboard deep link after deployment.
