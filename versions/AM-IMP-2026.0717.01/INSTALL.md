# Install

1. Deploy the AM Platform source containing this package.
2. Copy secret values in the Render dashboard according to `config/environment-map.json`; never copy values into this repository.
3. Keep the engineering Notion IDs unchanged and register them under `ENG_*`.
4. Set `AMCORE_HOME_TENANT=engineering` for the engineering custom-domain landing page.
5. During the transition, keep the old Portal feature/cookie aliases in `tenants/engineering.json`.
6. Run `npm run dryrun:engineering` plus the existing core/construction/media/triage/reminders/meetings dryruns.
7. Follow `docs/ENGINEERING_PLATFORM_CUTOVER.md` for deployment, webhook switching and rollback.

Do not disable or delete the old service during installation. It remains the rollback target until production verification is complete.
