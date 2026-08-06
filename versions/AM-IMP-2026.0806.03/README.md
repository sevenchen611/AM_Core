# HOZO Calendar Portal identity binding

This package extends the already-deployed HOZO AM 2.0 private LINE route with
the first formal `LINE userId ↔ Rental admin_users.id` binding flow.

The existing enabled-group member map remains a pre-check. A user must already
resolve to the unique HOZO AM 2.0 tenant before the `綁定 123456` command is
accepted. The command sends the one-time code and stable LINE user ID over the
dedicated AM→Rental machine API. Rental stores only an HMAC lookup hash and
encrypted LINE user ID ciphertext, then returns the minimum Portal identity
payload.

This package does not read or write Calendar items, AM tasks, financial data or
private notes. It does not allow LINE to revoke an account; revocation remains a
Rental Portal action. Unknown, expired, reused, conflicting or unavailable
identity operations fail closed.
