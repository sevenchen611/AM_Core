# Install

1. Apply the shared core changes in `core/router.js`, `core/direct-line.js`,
   `core/modules.js` and `server.js`.
2. Install `modules/personal-assistant/index.js`.
3. Add `personal-assistant` to the target tenant's module list.
4. Set `config.personalAssistant.enabled=true` only for the intended tenant.
5. Confirm every intended partner has sent at least one message in a formally
   enabled HOZO AM 2.0 group so the tenant-local `成員對照` contains the stable
   LINE user ID.
6. Run `node tools/dryrun-personal-line-routing.mjs` and the standard AMCore
   checks in `VERIFY.md`.
7. Deploy from the actual AM Platform production checkout. AMCore package files
   do not deploy production by themselves.

Do not enable the module for another tenant until cross-tenant user-ID overlap
has been reviewed. Enabling multiple tenants is supported, but duplicate user
IDs deliberately receive no private data.
