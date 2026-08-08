# Verify

Local checks:

```text
node --check modules/personal-assistant/index.js
node --check modules/tasks/index.js
node tools/dryrun-personal-line-routing.mjs
node tools/dryrun-tasks.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0808.01
node tools/audit-alignment.js
node tools/compare-project-manifests.js
```

Production checks:

1. `/health` shows HOZO AM 2.0 loaded without the `calendar` module.
2. `/health` or runtime logs show the tenant LLM chain has MiniMax available and
   the MiniMax model is `MiniMax-M3`.
3. In the private LINE assistant, send a multi-item create message. The assistant
   must reply with a preview and must not write before `確認新增`.
4. After `確認新增`, the AM tasks data source has one task per item with
   `來源=手動`, `狀態=待辦`, the user's display name as `負責人`, and LINE direct
   source evidence in the page body.
5. `我的今天` and `我的行事曆` read from AM tasks. They must not ask for Rental
   Portal binding.
6. Non-text direct messages do not repeat the old identity confirmation block.

