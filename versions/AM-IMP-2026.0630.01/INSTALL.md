# Install AM-IMP-2026.0630.01

This package was backfilled from a production upgrade record. Install it into a
target project (HOZO_AM, SevenAM, or a future AM project) by reproducing the changes
below in that project only. Never copy another project's secrets or data.

Authoritative source record: 7AM `UPGRADE-2026-06-30-AM-IMP-2026.0630.01.md`.

## Changes To Apply

(see authoritative upgrade record)

## Environment Variables (names only)

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REFRESH_TOKEN`
- `SEVEN_CALENDAR_ID`
- `SEVEN_CALENDAR_NAME`
- `SEVEN_CALENDAR_TIMEZONE`

## Data Isolation Check

Uses only SevenAM's own LINE channel, Notion workspace, Render service, and the
controller's own Google account. No Google secret or event data is stored in
AMCore or shared with HOZO_AM.
