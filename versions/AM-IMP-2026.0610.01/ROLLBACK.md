# Rollback

If the 08:30 morning brief schedule needs to be reverted:

1. In the project-local `render.yaml`, change only the morning brief cron schedule back to:

```yaml
schedule: "0 0 * * *"
```

2. Revert project-local copy from 08:30 / 早上 8 點半 back to 08:00 / 早上 8 點.
3. Update the project-local upgrade record and manifest status.
4. Verify Render shows the morning brief cron at 08:00 Asia/Taipei before marking rollback complete.
