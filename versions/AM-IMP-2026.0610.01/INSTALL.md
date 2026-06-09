# Install

Install this package separately in each project-local repo.

## Project Steps

1. Open the project-local `render.yaml`.
2. Find the morning brief cron service:
   - HOZO_AM: `hozo-am-morning-brief`
   - SevenAM: `seven-jr-morning-brief`
3. Change only that service schedule:

```yaml
schedule: "30 0 * * *"
```

4. Keep the command unchanged:

```text
npm run cron:report -- morning
```

5. Update project-local report labels and documentation from 08:00 to 08:30.
6. Add a project-local upgrade record under `docs/upgrades/`.
7. Update `docs/project-improvement-manifest.md`.

Do not change hourly LINE reconciliation schedules such as `0 0-14 * * *`.
