# Verify

Run npm run check; node --test tools/test-attachment-retrieval.mjs
tools/test-line-io.mjs tools/test-attachment-retention.mjs;
node --experimental-vm-modules tools/verify-attachment-webhook.mjs;
node tools/dryrun-core.mjs; node tools/dryrun-personal-line-routing.mjs;
node tools/check-upgrade-package.js AM-IMP-2026.1004.07;
node tools/audit-alignment.js; node tools/compare-project-manifests.js.

Regression covers explicit intent versus ordinary discussion, exact quotes,
historical binary source and filename/context lookup, duplicate identities,
foreign groups/data sources, private sender boundaries, revoked/re-bound/shadow
bindings, uncertain replies, transport reservation, missing sources, Drive failures
and modified original size/checksum. Existing storage streaming and webhook
acknowledgement checks must remain green.

Production GET /health must return the merged reviewed commit and
attachmentRetrieval.contract=line-quoted-drive-original-v1 with google-drive-link
delivery. Verify enabled tenant archive health. Read-only live index checks may
verify identification, but do not substitute mocks for live Drive or real LINE
reply verification. Do not send unsolicited test messages to production groups.

Authorized user acceptance: reply to a saved original with the example command,
open the returned Drive link with an authorized Google account. For historical
indexes without exact source identity, supply the complete filename. An unavailable
historical original must ask for re-upload instead of claiming recovery.
