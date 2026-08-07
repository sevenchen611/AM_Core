# HOZO private LINE claims entry

This package connects the existing 葉小蝸 Rich Menu text action `我要請款`
to the secured claims workflow.

The Rich Menu intentionally keeps a text action instead of storing a generated
LIFF URL. Claim URLs contain a signed, short-lived session and must never be
copied into a fixed menu. When an identified partner taps the Rich Menu, the
private LINE dispatcher now lets the claims module handle the command, resolves
the partner's eligible claim source from their active group bindings, and sends
a Flex card with a new 15-minute `開啟請款單` URI.

The direct flow preserves every existing claims safeguard:

- identity is the stable LINE user ID, never the display name;
- the source binding must be active and have the `請款` capability;
- the user must be in that binding's named submitter allowlist;
- claims LIFF, Rental base URL, and machine token configuration must be ready;
- exactly one eligible claim source is required;
- zero, multiple, or partially failed source lookups fail closed;
- the LIFF form re-verifies the LINE access token and original submitter;
- the Rich Menu cannot approve, reject, pay, or release a claim.

No LINE user ID, group ID, claim record, token, or production URL is committed
by this package. Live identity and claim-source data remain in the HOZO AM 2.0
tenant's own group binding and Rental data stores.
