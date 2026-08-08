# AM-IMP-2026.0808.01 — Unified private assistant tasks

Tenant: `hozo-am-2-0`

Installed a zero-migration private task cutover:

- `calendar` is removed from the HOZO AM 2.0 direct-message module list.
- Rental Calendar personal task write/query/update is no longer required for
  one-to-one assistant todos.
- Private task create/query/update now uses the AM tasks module.
- Multi-item natural-language create requests are previewed and require
  `確認新增`.
- Non-text direct messages no longer produce the repeated identity fallback.
- HOZO AM 2.0 pins the tenant LLM MiniMax backend to `MiniMax-M3` while keeping
  API keys in runtime environment variables.

Local verification passed:

- `node tools/dryrun-personal-line-routing.mjs`
- `node tools/dryrun-tasks.mjs`

Production verification:

- `/health` showed HOZO AM 2.0 modules loaded without `calendar`.
- `/health` showed the LLM chain starting with `minimax` model `MiniMax-M3`.
