# Verify

Run `node --test tools/test-line-io.mjs tools/test-line-io-card-appearance.mjs tools/test-line-bindings.mjs tools/test-line-directory.mjs`
and `node tools/check-upgrade-package.js AM-IMP-2026.1004.02`.

The synthetic tests cover a single category bubble with a same-color URI control,
wrapped links, unchanged default palettes, disabled actions, invalid appearance,
raw style/color rejection, URL safety, exclusive destinations, Reply and Push,
replay and payload-conflict checks. No production LINE message is sent.

Confirm the deployed health commit. Serialize the consumer's category card and
validate it with the gateway renderer before enabling the opt-in field. Existing
LINE messages are immutable; newly requested cards use the updated format.
