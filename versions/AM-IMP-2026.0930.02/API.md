# UOF review-card link actions

The existing `cards` message contract accepts `uri` actions with HTTP or HTTPS
schemes and a maximum of 1000 characters, matching LINE's URI action limit.
Credentials embedded in the URL are rejected. Other schemes and arbitrary Flex
JSON remain unsupported.

URI actions open in LINE's in-app browser. HTTP links do not protect traffic
with TLS; the UOF caller should label them as unencrypted and the user should
open them only on a network where that connection is appropriate. Internal
network URLs remain reachable only when the user's device can access that
network.
