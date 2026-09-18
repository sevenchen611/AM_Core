# Bank draft notification personnel registry

Use the existing claims-management member registry for the actual LINE mention
in Rental finance notifications. Keep the canonical group binding, dedicated
machine credential, immutable notification identities, and provider receipt guards.
No personnel copies, new secret variables, schema changes, or bank operations.

Status: Deployed (PR 181 exact formal commit verified); actual original three
notification receipts still pending. Safe allowlisted failure reasons distinguish
missing group/name/reference, denied/left state, and ambiguity without PII.
