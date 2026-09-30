# Cards contract (1.4.0)

POST `/api/v1/line/messages` retains groupId, notifyUserId, text and Idempotency-Key.
`text` becomes the Flex preview text when `cards` is provided. The bound owner is
still mentioned. `cards` cannot be combined with legacy `actions`.

`cards`: 1..6 objects, each with title (1..100 chars), optional eyebrow (1..80),
subtitle (1..200), body (1..3000), fields (0..12 label/value pairs, limits 80/500),
and actions (0..3). Each action contains label (1..20) and exactly one of data
(postback, 1..300), uri (HTTP or HTTPS without credentials, <=1000), or disabled:true.
Unknown properties are rejected. Bubbles must be <=28KB and total contents <=45KB.
No external caller may submit arbitrary Flex components or LINE JSON.

New message identities include the complete card payload. Legacy identities are
unchanged. Authorization and delivery retry semantics are unchanged.
