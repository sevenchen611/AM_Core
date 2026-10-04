# Bounded appearance for review card actions

Status: Ready. A URI action can use the same primary palette as category actions
without sending arbitrary LINE presentation properties through the API.

Review actions accept the optional `appearance` field with exactly `primary` or
`secondary`. Omission retains the existing default: postbacks use primary, URI
actions use secondary, and disabled actions remain unavailable. Appearance does
not change the action destination, authorization, membership checks or idempotency.
Disabled actions cannot opt into an appearance. Raw `style` and `color` fields
remain invalid.

Example: `{ "label": "Open control", "uri": "https://example.com/control", "appearance": "primary" }`.
The gateway uses its own palette for native buttons and wrapped text actions in
both Reply and Push. Deploy the gateway before a consumer opts into this field.
