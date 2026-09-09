# Verify

Run from the AM Platform repository root:

```text
node --check modules/company-line-push/index.js
node tools/verify-company-line-push.mjs
node tools/verify-line-push-timeout.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0909.01
```

The finance-route verifier must prove:

- successful resolution passes `{ name, userId }` to the existing LINE sender;
- the HTTP response contains no LINE user id;
- omitted `mentionName`, a name absent from text, caller-supplied targets,
  missing mappings, malformed mappings, invalid ids, and normalized duplicate
  names all stop before push and return non-2xx with `ok: false`;
- missing, malformed, or payload-mismatched retry keys stop before push;
- a repeated identical payload uses the identical provider retry key, while a
  provider `409` without accepted-request evidence is not delivered;
- unrelated page text cannot select a finance binding and exact duplicate
  canonical bindings on later Notion pages fail closed;
- raw duplicate member-map keys are rejected before JSON last-key-wins parsing;
- a mapping found on another binding page is never used;
- dry run resolves but does not claim delivery and does not call LINE.

No production LINE push is part of local verification.
