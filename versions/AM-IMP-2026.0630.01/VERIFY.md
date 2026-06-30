# Verify AM-IMP-2026.0630.01

## Verification Performed (from source record)

Full end-to-end verified against the real Google account (sevenchen611@gmail.com):

- Google Cloud project `sevenam-499307` created; Calendar/Tasks/Drive/Docs/Sheets/
  Gmail APIs enabled; OAuth consent screen configured (External) and **published to
  Production** (durable refresh token, no 7-day Testing expiry).
- OAuth Web client created (redirect `http://127.0.0.1:53682/`); client id + secret
  stored in `.env`.
- `npm run gcal:auth` minted a refresh token covering all six scopes
  (calendar, tasks, drive.file, documents, spreadsheets, gmail.modify).
- `--ping` authenticated and listed calendars; `--ensure-calendar` created the
  dedicated **SevenAM** calendar; a test event was created and deleted (write+delete OK).

## Re-verification For A New Install

- `node --check` passes on any changed scripts.
- The target project shows the new behavior using its own data only.
- No values from another project appear in config, logs, or output.
