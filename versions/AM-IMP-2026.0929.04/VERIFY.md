# Verification

Run from the package checkout:

```text
npm ci --ignore-scripts --no-audit --no-fund
node --check server.js
node --test tools/test-line-bindings.mjs tools/test-line-io.mjs tools/test-line-directory.mjs
node tools/test-line-io-sql.mjs node_modules/@electric-sql/pglite/dist/index.js
node tools/check-upgrade-package.js AM-IMP-2026.0929.04
```

Synthetic tests cover key separation, no plaintext codes, pre-confirmation denial, wrong-account denial, exact sender filtering, membership suspension, outage denial, owner-confirmed resume, atomic rebind, historical event isolation, idempotent confirmation buttons, recipient validation, expiry, rate limits and protection of existing static groups. PGlite exercises SQL constraints and transactions; its test adapter skips PostgreSQL advisory-lock functions, so concurrent production lock semantics are not claimed by these tests.

After deployment, verify health reports `bindingsEnabled:true` and version `1.3.0`. Use the pilot owner's actual signed-in UOF session to obtain a code, manually create the group/invite OA, post the code, inspect the candidate and confirm. Use a harmless query to verify transport. Adding another member must suspend both input and output. Confirm the existing static UOF group and read-only directory still work. Do not execute a real approval solely as a transport test.

Only mark Deployed after checking the actual deployed commit, schema, keys and signed webhook flow. UOF long-term authorization and return/reject APIs require their own native-site verification.
