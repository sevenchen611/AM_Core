# Verify

Run:

```text
node --check server.js
node --test tools/test-work-journal-entry.mjs tools/test-journal-external-browser-url.mjs
node --experimental-vm-modules tools/verify-private-assistant-pause.mjs
node --experimental-vm-modules tools/verify-attachment-webhook.mjs
node --experimental-vm-modules tools/verify-bank-line-reply-intake.mjs
node --experimental-vm-modules --test tools/test-leaf-calendar.mjs
node tools/check-upgrade-package.js AM-IMP-2026.1007.02
node tools/audit-alignment.js
node tools/compare-project-manifests.js
```

The isolated tests cover exact command recognition, exclusions, per-user/default menus, changing active menus, read failure recovery, no guessed URI, signature rejection, paused-assistant bypass and mixed UOF event isolation. Existing attachment, bank and calendar regressions use fictional records and no production messages.

Verify the deployed reviewed main commit and the new health contract. Validate the reply template using the target LINE validation endpoint without sending a message. Verify its URI equals the current journal Rich Menu action, not a separately configured address. Never send a production test message without human authorization.

Phone acceptance: in the actual OA private chat, send `工作日誌`, tap `開啟工作日誌`, and confirm the same page and browser behavior as the Rich Menu. Sign in as needed. Existing 待簽/待辦 behavior and journal data must remain unchanged. Record iOS/Android and LINE version; do not describe isolated tests as phone acceptance.
