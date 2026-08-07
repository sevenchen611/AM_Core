# AM-IMP-2026.0807.02 — Personal Calendar LINE operations

Tenant: `hozo-am-2-0`

Installed the Rental-backed personal Calendar command module for the one-to-one
LINE assistant. Every query and write resolves the active Rental identity link.
Personal creates require explicit confirmation; AM-originated items remain
source-backed and read-only.

Production status is updated only after the merged AM Core commit is live and a
fresh LINE query/create/update smoke test succeeds.
