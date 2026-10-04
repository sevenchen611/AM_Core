# Attachment retention — green-hotel

Status: Deployed. Core package: AM-IMP-2026.1004.04.

The tenant-local additive schema is installed. Reviewed main commit b99dd8c is
verified on the production AM Platform service. Live archive health is ready; this
tenant independently saved a controlled 40,647,423-byte synthetic original to its
own Drive root with exact SHA256 and MD5. The controlled source was a managed
Notion original; real large-file LINE webhook and forced production failure
canaries were not performed. Local durable intake/restart/failure/isolation tests
and both PR CI runs passed. LINE provider redelivery awaits interactive login.

See the core package PRODUCTION-VERIFY.md for acceptance and remaining checks.
No customer content, production IDs, credentials or file bytes are stored here.
