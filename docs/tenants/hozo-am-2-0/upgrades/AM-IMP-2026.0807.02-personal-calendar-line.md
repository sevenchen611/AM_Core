# AM-IMP-2026.0807.02 — Personal Calendar LINE operations

Tenant: `hozo-am-2-0`

Installed the Rental-backed personal Calendar command module for the one-to-one
LINE assistant. Every query and write resolves the active Rental identity link.
Personal creates require explicit confirmation; AM-originated items remain
source-backed and read-only.

Production deployments verified on 2026-08-07:

- Rental Calendar `aae1796`: Seven identity query, personal create/cancel, AM
  source upsert/close, evidence gate, and source read-only guard passed.
- AM Platform `680b58b`: `calendar` is loaded for HOZO AM 2.0 and the deployed
  direct-message flow handled query, confirmed create, list, and cancel without
  warnings.
