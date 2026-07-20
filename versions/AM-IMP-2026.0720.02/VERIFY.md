# Verify

1. Run `node tools/check-upgrade-package.js AM-IMP-2026.0720.02`.
2. Run `node tools/audit-alignment.js` in AMCore.
3. Confirm the runtime reports Green Hotel AM as disabled until setup is complete.
4. Run `node --env-file=.env tools/verify-platform-connection-identities.mjs <Green-Hotel-Drive-root-folder-ID>`; it must confirm BuildAM and the active, editable Drive root before enablement.
5. After credentials and sources are configured, confirm `green-hotel` has a Notion parent page, Messages source, Group Bindings source, and its own Drive root.
6. Bind one test LINE group and confirm a message is stored only in Green Hotel sources.
7. Confirm an unbound group is ignored and a group bound to another tenant cannot route to Green Hotel.
8. Confirm any created task includes its source message or meeting evidence and group binding.
9. Confirm the first meeting in a bound group provisions a meeting database under the Green Hotel parent page, not under another tenant.
10. Confirm operational-memory reports `off` until `GREEN_HOTEL_AM_MEMORY_DATABASE_URL` is configured and the PostgreSQL RLS migration passes.
