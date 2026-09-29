# API 1.3.0 binding extension

Use HTTPS and `Authorization: Bearer <server-only-management-key>`. All responses have `Cache-Control:no-store`. Errors are `{ "error":"sanitized_code" }` with HTTP 400/401/403/404/409/429/503. Management bodies are JSON and limited to 4096 bytes; unknown properties are rejected. The manager key cannot read messages or send; IO/directory keys cannot use these endpoints.

| Method/path under `/api/v1/line` | Inputs | Result |
|---|---|---|
| POST `/bindings/start` | `externalUserId`, `displayName`, optional boolean `replace` | Pending binding, ten-minute `command`, `suggestedGroupName`; only this response returns the code. `replace:false` returns an existing bound/suspended binding if present. |
| GET `/bindings/{bindingId}?externalUserId=...` | GUID and application-authenticated account | Binding status; bound groups are reverified live. Temporary provider failure returns 503. Definitive identity/count failure suspends. |
| POST `/bindings/{bindingId}/confirm` | `externalUserId` | Verify candidate identity and atomically activate, revoking the old binding. |
| POST `/bindings/{bindingId}/resume` | `externalUserId` | Reverify and activate the original suspended group after owner confirmation. |
| DELETE `/bindings/{bindingId}` | JSON `externalUserId` | Revoke this binding and cancel pending replacements for this account. |

The application must derive externalUserId from its authenticated server session, never an arbitrary browser field. A binding belongs to the manager's configured tenant and target IO client. Missing/foreign account bindings return 404. The binding view contains `bindingId`, `status`, `externalUserId`, group/user IDs and display names, `expiresAt`, `lastVerifiedAt`, and IO flags. States: pending_line, pending_confirmation, bound, suspended, expired, revoked. Five start attempts per account in ten minutes are permitted.

The existing IO contract is extended without changing old messages: `/groups` and `/events` include only that client's active dynamic bindings; input matches both current binding ID and sender, so prior owners' history is not readable. Personal reads and writes revalidate membership. For a personal `/messages` request, explicit `notifyUserId` must equal its bound owner. Optional `actions` is an array of one to three `{label,data}` postback buttons, label up to 20 UTF-16 code units and opaque data up to 300. Unknown properties are denied. The required Idempotency-Key covers the full text, recipient and actions. Buttons do not authenticate UOF or execute business actions themselves. Requests without actions retain the prior idempotency hash.

The group binding command is `綁定 UOF <22-character-base64url-code>`, issued within ten minutes through the existing signed OA webhook. It creates a candidate only; application confirmation is still required. Legacy static groups and other Notion-bound groups cannot be claimed. Malformed, expired or conflicting commands cannot enable IO; the owner requests a new code if no candidate appears.
