# Rollback

Restore the previous project-local LIFF environment value and rebuild the
runtime. This returns authentication to the earlier provider and therefore also
restores its cross-provider membership failure; use only for emergency service
recovery while a same-provider LIFF is repaired.

Do not delete or recreate the issued contract session, change the designated
signer, or resend the LINE invitation during rollback. The signing link and
evidence records remain valid because the raw signing token and contract bundle
are unchanged.
