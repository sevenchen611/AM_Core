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
  "mentionName": "陸昱晴"
}
```

This endpoint uses the same machine credential as the Rental company-group API,
but resolves exactly one group binding whose fields contain `HOZO 財務群組`.
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
