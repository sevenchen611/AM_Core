# Verify

Run from the root AM Platform checkout:

```text
node --check server.js
node --check core/direct-line.js
node --experimental-vm-modules tools/verify-private-assistant-pause.mjs
node tools/dryrun-personal-line-routing.mjs
node tools/dryrun-line-task-control.mjs
node --experimental-vm-modules tools/verify-attachment-webhook.mjs
node --experimental-vm-modules tools/verify-bank-line-reply-intake.mjs
node tools/check-upgrade-package.js AM-IMP-2026.1006.02
node tools/audit-alignment.js
node tools/compare-project-manifests.js
```

The pause verifier executes the real server handler with signed synthetic events. AM private text, identity/task/claims commands, binary messages, postbacks and follow/unfollow events are acknowledged without calling intake, lookup, dispatch or replies. A mixed batch preserves group/room events and an explicitly owned independent transport event; unowned UOF-like text is still paused. Invalid signatures still fail. Health exposes the pause state. Enabled-mode routing tests remain as resumption coverage. Run `node --test tools/test-line-bindings.mjs` to verify the independent UOF ownership and sender checks.

After production deployment, verify the deployed main commit and `personalAssistant.enabled=false` with contract `private-assistant-pause-v1` at `/health`. User acceptance: one-to-one messages and commands receive no assistant response. Do not send user-facing LINE messages without explicit authorization.

Alignment audit with current local project path overrides reports 13 pre-existing July manifest gaps. Manifest comparison also ran. This package does not claim overall standalone-project alignment.
