# LINE selector directory

Status: Installed locally. Production activation is pending deployment-owned schema migration and authenticated service configuration.

The selector exposes known OA group routing metadata and current, verifiable group-member identities through separate directory:read endpoints. A scoped IO key retains its existing tenant group allowlist. The OA operator can use a separate directory-only key with directoryAllGroups enabled; this key cannot read messages or send reports. The directory schema contains no tenant conversation contents.

The user defined active as currently in the group and available for notification. Each returned active user requires a successful current group-member profile lookup. Last interaction time remains separate. Full enumeration is unavailable on OAs without verified/premium permission, and unseen historical groups cannot be enumerated by LINE.

Verification: local API, real disposable PostgreSQL directory, signed durable input, idempotent delivery, bank-intake regression and core routing checks passed. Full legacy project alignment still has pre-existing project folder/manifest gaps. Do not mark this record Deployed until the actual directory is enabled and authenticated production reads pass.
