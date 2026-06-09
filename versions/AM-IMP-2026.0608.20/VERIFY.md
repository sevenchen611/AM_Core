# Verify

## SevenAM

```text
node --check scripts\generate-0800-daily-report-preview.js
node scripts\generate-0800-daily-report-preview.js
```

Confirm:

- The generated HTML has a `今天的行程安排` section.
- With no Calendar input, the section says Google Calendar is not connected.
- With Calendar event JSON input, events are shown in time order.
- HOZO AM files are unchanged.

## AMCore

```text
node tools\check-upgrade-package.js AM-IMP-2026.0608.20
```
