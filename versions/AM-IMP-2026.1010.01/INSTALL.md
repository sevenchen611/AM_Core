# Install

Apply the changes in `core/central-archive/store.js` and `core/leaf-calendar/extract.js` together with their regression tests to the AM Platform root runtime. Existing JSONB schema is sufficient; no migration, secret change or record rewrite is needed.

Run VERIFY before review. Production installation uses a reviewed commit merged to GitHub main and the actual AM Platform service. Preserve the paused general private assistant and current tenant configuration. Existing unprompted drafts retain their source, revision and retry key and become deliverable on their next scheduled retry.

After verifying the live commit, run `node tools/retry-unprompted-calendar-previews.mjs` in that service for count-only diagnosis. To resume delayed previews immediately, add `--apply --expected-commit <verified-40-character-live-commit>`. This scans configured active tenants only and moves the next attempt time of unexpired, unprompted, unleased pending drafts to now. It preserves payload, source, revision, request identity and confirmation state. It does not send messages itself; the existing worker handles eligible drafts. Already prompted, closed, expired and currently leased drafts are excluded. Output contains tenant counts only.

For a shared runtime, use the verified live `/health` field `lineCalendar.configuredTenants` and run with `--tenant <configured-tenant>` for each entry. Other active tenants may intentionally have no calendar schema permission or service enrollment; a broad dry run reports those stores unavailable and does not change them. Do not grant calendar access merely to suppress that diagnostic. Shared LINE push/reply normalization is independent of calendar enrollment.

Do not copy bindings, accounts or drafts to HOZO_AM or SevenAM. Any standalone adaptation requires separate installation and project-local manifest evidence.
