# AM-IMP-2026.0608.20 SevenAM 08:00 Google Calendar Agenda Section

This package records a SevenAM-only upgrade for the 08:00 morning report.

## Purpose

Add a `今天的行程安排` section to the SevenAM 08:00 report so the controller can see the day's Google Calendar schedule before deciding task priority and report interventions.

## Scope

- Install target: `SEVEN_AM`
- HOZO AM: not installed by request

## Behavior

The SevenAM report generator now supports Calendar event input through:

```text
SEVEN_GOOGLE_CALENDAR_EVENTS_JSON
SEVEN_GOOGLE_CALENDAR_EVENTS_FILE
```

When events are available, the report displays:

- time range
- event title
- location or short note
- busy/reference tag

When events are unavailable, the report shows a clear `Google Calendar 尚未連線` state instead of using fake schedule data.

## Data Separation

This package does not store Google Calendar event records in AMCore.

Calendar events remain SevenAM project-local report inputs.
