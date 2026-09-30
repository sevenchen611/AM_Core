# Rollback

Revert the reviewed-main commit and redeploy the preceding gateway release.
The caller must stop sending HTTP URI actions before the old gateway is live;
otherwise the old validator will reject those messages. Existing bindings,
outbox rows, credentials, and UOF data remain untouched.
