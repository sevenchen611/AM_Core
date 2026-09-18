# Verify

- npm run check
- npm run dryrun:claims-authority
- npm run verify:bank-mention
- node tools/check-upgrade-package.js AM-IMP-2026.0918.01
- node tools/audit-alignment.js
- Confirm formal /health financeMentionRegistry and main commit.
- Verify each original draft notice has a real delivered receipt and sent timestamp.
- Verify payable amounts remain unpaid and bank review/release were not invoked.

Code deployment is not proof of actual recipient binding or notification delivery.
Unexpected protected failures expose only a fixed pipeline stage, fixed cause
category and allowlisted SQLSTATE, never exception text, queries, IDs or secrets.
The v2 contract includes mentionIdentityReference in the caller payload digest.
Original sourceNotificationId is preserved; an already-bound v1 event changing
to v2 returns source_notification_conflict rather than sending twice.
Verify different LINE nicknames resolve only by the verified reference, and
missing, ambiguous, denied, left, wrong-tenant or conflicting identities fail.
Missing/ambiguous exact reviewer identity must remain blocked, not marked delivered.
