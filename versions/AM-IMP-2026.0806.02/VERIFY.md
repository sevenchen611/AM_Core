# Verify

Run locally:

```text
node --check server.js
node --check core/router.js
node --check core/direct-line.js
node --check core/modules.js
node --check modules/personal-assistant/index.js
node tools/dryrun-personal-line-routing.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0806.02
node tools/audit-module-authorization.mjs
node tools/audit-alignment.js
```

The dry run must prove:

1. Exact user-ID matching, including rejection of substring candidates.
2. Multiple enabled groups in one tenant merge into one private identity.
3. Shadow and disabled groups do not grant private access.
4. Cross-tenant duplicates and lookup failures fail closed.
5. `onDirectMessage` runs while ordinary group `onMessage` does not.
6. Unbound users receive a safe explanation without project writes.
7. Group events bypass the private route.

Production verification requires a fresh one-to-one LINE event from a known
HOZO AM 2.0 member. The reply must name HOZO AM 2.0, and the same event must not
create a group message, candidate task, meeting or triage record.
