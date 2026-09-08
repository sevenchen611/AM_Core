# Rollback

Revert the package commit and redeploy the preceding verified AM Platform
revision.

No database rollback or artifact cleanup is required. The package adds no
schema and mutates no stored contract, signing event or final artifact. A
runtime rollback restores the previous post-completion token behavior, so use
only if the permanent entry or final-artifact checks cause an operational fault.
