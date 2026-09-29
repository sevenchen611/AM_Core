# Rollback

1. Callers stop supplying `notifyUserId` and return to the configured default recipient. Retain existing idempotency keys and pending-send payloads.
2. If reverting source, revert only the reviewed changes for this extension. Preserve the base gateway, stored input and send receipts. Deploy the reviewed rollback through main.
3. An old runtime rejects a request containing `notifyUserId`; callers must remove the field. Do not blindly retry changed-recipient requests with new keys after an uncertain send.
4. Update the tenant upgrade record with the rollback and remaining limitations. No table deletion or credential rotation is required.
