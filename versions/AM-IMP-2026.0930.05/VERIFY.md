# Verify

Run `node --test tools/test-line-io.mjs tools/test-line-bindings.mjs tools/test-line-directory.mjs`
and `node tools/check-upgrade-package.js AM-IMP-2026.0930.05`. Build the UOF
application. Confirm a synthetic inline action creates exactly one Flex Reply
message, with no footer and no Push. In LINE, tap only `查看結果` and confirm
it invokes the existing UOF result-check flow. Do not submit a real approval as
a transport test.
