# Rollback

Revert this package and redeploy the preceding release. This restores the old
callback cleanup order and removes the one-attempt login guard; it may therefore
restore the LINE Login loop on affected mobile flows.

No database, stored contract, signature evidence, LINE message, or environment
variable needs rollback.
