# Personal LINE group binding API 1.3.0

Status: Ready for review; not installed or deployed by this package.

An authenticated application can issue a short-lived binding code, receive a signed LINE group event, show the candidate identity to its signed-in owner, and activate one private group after explicit confirmation. The group must contain exactly one human member plus the OA. This feature is transport-only: UOF authentication, case permissions, schedules and workflow decisions stay in the UOF application.

Codes contain 128 bits of randomness, expire in ten minutes, are hashed at rest, and are single-use. One account has one active binding. Replacement preserves the old binding until the new candidate passes verification, then switches atomically. Group membership/lifecycle changes suspend IO. Provider failures stop IO without fabricating invalid membership. Returning to the original group requires owner confirmation.

The management key has only `bindings:write` and targets one separate same-tenant transport client. Ordinary IO and directory keys cannot manage bindings. Dynamic groups are authorized by tenant, client, binding ID and exact sender/recipient. Reusing a group cannot expose a prior owner's event history. Postback buttons contain only opaque confirmation IDs; native signing runs exclusively in the application's backend.

The existing OA webhook remains the only webhook. Consumed binding commands, candidates and inactive personal groups do not enter AM task extraction. Existing static-group transport, directory clients and tenants retain their contracts. Deployed metadata must stay in deployment-owned PostgreSQL; no real groups, users, messages, keys or business cases belong in this package.

Application-side authorization renewal and return/reject workflow contracts are separate readiness requirements. Passing these transport tests is not proof that UOF signing or unattended reports are ready.
