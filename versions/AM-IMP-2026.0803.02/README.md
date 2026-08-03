# AM-IMP-2026.0803.02 - LINE group name repair

This package prevents a group onboarding command from writing a preset or user-supplied name for another group into the current LINE group binding.

The LINE `groupId` remains the binding key. During onboarding, AM Platform reads the current group's summary from LINE and uses that name only for the tenant-local binding record. When a group is already bound to the requested tenant, the command repairs the display name, purpose, goal label, and audit fields without resetting the group's configured status, capabilities, meeting mode, or project relation.

No LINE group IDs, Notion IDs, customer messages, credentials, or tenant records are included in this package.

## Scope

- Keep the legacy HOZO AM 2.0 onboarding command compatible without its old hard-coded group name.
- Resolve the current group name through the LINE Messaging API group-summary endpoint.
- Repair a same-tenant binding safely when the command is sent again.
- Reject cross-tenant rebinding as before.

## Data isolation

The existing router still decides ownership exclusively by `groupId`, and every Notion read or write remains tenant-keyed. This package only updates the binding record in the tenant that already owns the current LINE group.
