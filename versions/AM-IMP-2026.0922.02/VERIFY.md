# Verify

Run:

```text
node tools/dryrun-claims.mjs
node tools/dryrun-claims-authority.mjs
node tools/dryrun-claims-authority-routing-login.mjs
```

Then create a new synthetic claim from a non-accounting LINE group and confirm
that a return event is delivered to that same group with its reason.
