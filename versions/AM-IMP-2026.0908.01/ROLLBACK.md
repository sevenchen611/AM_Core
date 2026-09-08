# Rollback

Revert the package commit and redeploy the previous verified AM Platform
revision.

No database rollback is needed because this package has no schema or data
migration. Do not delete, recreate, or alter any contract version, signing
session, signature evidence, Party A signature artifact, signed PDF, or receipt.

If a finalization attempt had already moved a signing session to `confirmed`,
leave that durable state intact. The completion service is designed to resume
from `confirmed` without requiring either party to sign again.
