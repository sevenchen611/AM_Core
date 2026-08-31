# AM-IMP-2026.0831.01 - Finance Claims v3 through 葉小蝸

Tenant: `hozo-am-2-0`
Status: Installed

## Purpose

Keep `葉小蝸 AI 小助手` as the only user-visible LINE OA while routing the
allowlisted group commands `請款` and `費用申請` to the Finance Claims v3
backend. Other 葉小蝸 commands and modules continue through the existing AM
Platform dispatcher.

## Runtime contract

The claims module revalidates the active group binding and named submitter, then
forwards a minimal signed-inbound event to the Finance v3 gateway:

- `POST /control/finance/group-events/v3`
- contract `finance-claims-v3.group-event-ingress-v1`
- bearer authentication over HTTPS
- only event id, timestamp, exact command, group id, and sender id are sent

The old `am-claims-v1` form is not used when the v3 switch is enabled. If the
gateway is unavailable or the identity is not allowlisted, the command fails
closed and does not fall back to the old form.

## Environment

Set all values before enabling the switch:

- `HZ2_FINANCE_CLAIMS_V3_GATEWAY_URL`
- `HZ2_FINANCE_CLAIMS_V3_GATEWAY_TOKEN` (at least 32 characters)
- `HZ2_FINANCE_CLAIMS_V3_GROUP_ENTRY_ENABLED=true`

Keep the enable flag false until the downstream receiver, recipient bindings,
group scope, AM bridge, and notification capability all report ready.

## Verification

```text
npm run dryrun:finance-v3-gateway
node --check modules/claims/index.js
```

Live verification in an allowlisted group:

1. Send exactly `請款`.
2. Confirm no legacy Flex card is posted in the group.
3. Confirm only the applicant receives the short-lived v3 web-entry link.
4. Submit one test claim and confirm the group receives only the creation notice.

## Rollback

Set `HZ2_FINANCE_CLAIMS_V3_GROUP_ENTRY_ENABLED=false`. This restores the legacy
group command behavior without deleting v3 queues, delivery ledgers, or finance
records. Do not rotate or delete credentials during the immediate rollback.
