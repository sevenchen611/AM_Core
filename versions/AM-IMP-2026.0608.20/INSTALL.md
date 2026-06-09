# Install

Install only in SevenAM.

1. Update SevenAM `scripts/generate-0800-daily-report-preview.js`.
2. Add Calendar input settings to SevenAM `.env.example`.
3. Do not copy this change into HOZO AM.
4. Generate a local preview:

```text
node scripts\generate-0800-daily-report-preview.js
```

5. For a Calendar display test, provide either:

```text
SEVEN_GOOGLE_CALENDAR_EVENTS_JSON
SEVEN_GOOGLE_CALENDAR_EVENTS_FILE
```

6. Record the install in SevenAM `docs/project-improvement-manifest.md`.
