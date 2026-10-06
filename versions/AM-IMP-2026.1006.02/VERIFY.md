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

The pause verifier executes the real server handler with signed synthetic events. Private text, identity/task/claims commands, binary messages, postbacks and follow/unfollow events are acknowledged without intake, lookup, dispatch or replies. A mixed private/group/room batch reaches every group intake path with only the group and room events. Invalid signatures still fail. Health exposes the pause state. Existing enabled-mode routing tests remain as resumption coverage.

After production deployment, verify the deployed main commit and `personalAssistant.enabled=false` with contract `private-assistant-pause-v1` at `/health`. User acceptance: one-to-one messages and commands receive no assistant response. Do not send user-facing LINE messages without explicit authorization.

Alignment audit with current local project path overrides reports 13 pre-existing July manifest gaps. Manifest comparison also ran. This package does not claim overall standalone-project alignment.
