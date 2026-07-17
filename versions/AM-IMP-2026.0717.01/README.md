# AM-IMP-2026.0717.01 Engineering AM convergence into AM Platform

## Outcome

AM Platform becomes the single codebase and runtime target for the engineering tenant. The legacy standalone engineering service is retained only as a temporary production rollback until the webhook/domain cutover passes observation.

## Included

- Enable the complete engineering module chain: collect, meetings, media, triage, queue, tasks, reminders, construction.
- Preserve meeting-roster handling before AI triage.
- Load engineering secrets and settings from `ENG_*`, including Notion, Portal, calendars, reminders and optional tenant AI keys.
- Add tenant-scoped PIN cookies and tenant-aware Portal authorization, including temporary legacy engineering aliases.
- Add the construction-owned `/tickets` UI and compatibility redirects from old queue ticket APIs.
- Make the platform root/login take over the engineering backend entry point.
- Keep all existing engineering Notion data in place; no data copy or backfill.

## Status

`Ready` for AM Platform deployment and controlled cutover. This package does not change the production webhook, DNS, Render service or legacy repository by itself.

## Data boundary

The package contains no tokens, customer data, production database IDs, LINE messages or Notion records. Runtime access remains tenant-locked by the AM Platform Notion guard.
