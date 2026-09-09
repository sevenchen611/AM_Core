# HOZO Company Line Push

This module exposes machine-only APIs for sending text to the HOZO company LINE group.

## Control API

```http
POST /control/hozo/company-group/push
Authorization: Bearer <AMCORE_QUEUE_ACCESS_KEY | HZ2_QUEUE_ACCESS_KEY | AMCORE_PORTAL_SERVICE_TOKEN>
Content-Type: application/json
```

Body:

```json
{ "text": "message to send" }
```

## HOZO Rental API

```http
POST /control/hozo/rental/company-group/push
Authorization: Bearer <HZ2_RENTAL_COMPANY_GROUP_PUSH_KEY>
Content-Type: application/json
```

`HOZO_RENTAL_COMPANY_GROUP_PUSH_KEY` is also accepted as an environment alias for the same key.

Body:

```json
{ "text": "message from HOZO Rental" }
```

Use dry run before production wiring:

```json
{ "text": "test message", "dryRun": true }
```

The caller cannot provide a LINE group id. The module resolves exactly one group binding whose fields contain `HOZO 公司群`, masks the target id in responses, and sends through the shared LINE OA.

## HOZO Rental Finance API

```http
POST /control/hozo/rental/finance-group/push
Authorization: Bearer <HZ2_RENTAL_COMPANY_GROUP_PUSH_KEY>
Content-Type: application/json
```

Body:

```json
{
  "text": "@陸昱晴 finance workflow message from HOZO Rental",
  "mentionName": "陸昱晴",
  "sourceNotificationId": "bank-draft-notification:v1:<UUID>",
  "retryKey": "finance-notification:v1:<64 lowercase hex characters>"
}
```

This endpoint uses the same machine credential as the Rental company-group API,
but resolves exactly one group binding whose canonical title/`群組名稱` is
exactly `HOZO 財務群組` after NFKC/whitespace normalization.
Its LINE destination is read only from that page's canonical `LINE 群組 ID`
property. That property must contain exactly one rich-text item whose trimmed
value is `C` followed by exactly 32 hexadecimal characters. Missing, multiple,
or malformed values fail closed; no other page text is searched for a group id.
The caller cannot provide a LINE group id or LINE user id. `mentionName` is
required and must occur in `text`. The endpoint resolves exactly one matching
name from that one finance binding page's `成員對照` JSON and passes the
resolved identity to the shared LINE `textV2` mention sender.

Missing, malformed, unknown, ambiguous, or invalid member mappings fail closed
without sending. The response reports only the mention name and
resolved/delivered booleans; it never returns the LINE user id. Callers must
record every non-2xx response as a notification failure and must not mark the
notice as delivered unless `ok`, `mention.resolved`, and `mention.delivered` are
all true.

`sourceNotificationId` is required and must be a stable identifier created by
Rental for one bank-draft notification event. Its exact format is
`bank-draft-notification:v1:<UUID>` (RFC variant, UUID versions 1 through 5).
Rental must reuse it only when replaying the same event with identical content;
two distinct events need distinct ids even when their visible text is equal.
The route durably binds the source id to the content digest. Reusing a source id
with changed content returns HTTP 409 `source_notification_conflict` without a
LINE push.

`retryKey` is also required. Its digest is SHA-256 over the UTF-8 JSON encoding
of this fixed-order normalized identity:

```json
{"contract":"hozo-rental-finance-group-mention-v1","sourceNotificationId":"<lowercase stable source id>","text":"<trimmed text>","mentionName":"<NFKC + trimmed name>","imageUrls":["<accepted HTTPS URL in delivery order>"]}
```

Prefix the lowercase 64-character digest with `finance-notification:v1:`.
The endpoint recomputes it and rejects a reused key whose normalized payload is
different. The endpoint derives a second opaque provider retry seed from the
verified content key plus the resolved group/member routing identity; the shared
LINE sender hashes that seed to the provider UUID retry header. A provider `409`
counts as delivered only when LINE returns an accepted request id for that same
content and route.
