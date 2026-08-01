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
