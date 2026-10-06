# Install

Merge the reviewed package/assets/apply-script change to main. Run from that clean revision:

```text
node tools/apply-compact-rich-menu.mjs --journal-url <confirmed-HTTPS-URL>
node --env-file=<project-local-env> tools/apply-compact-rich-menu.mjs --journal-url <confirmed-HTTPS-URL> --expected-bot <verified-basic-id> --receipt <outside-AMCore-receipt.json> --apply
```

The left area opens the supplied address without sending a chat message. The right area sends 待簽 when clicked by the user. Application validates the actual channel and LINE object, uploads the image before changing the default and verifies exact actions.
