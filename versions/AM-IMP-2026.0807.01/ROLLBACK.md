# Rollback

1. Revert the claims module's `onDirectMessage` handler.
2. Revert the personal assistant's claim-command delegation.
3. Redeploy the prior AM Platform revision.
4. Leave the Rich Menu text action `我要請款` in place; it will return the
   normal private-assistant fallback until the direct claims route is restored.
5. Do not delete claim sources, bindings, allowlists, sessions, Rental records,
   or audit records.

Existing group claim commands and already created claims are not removed by
this rollback.
