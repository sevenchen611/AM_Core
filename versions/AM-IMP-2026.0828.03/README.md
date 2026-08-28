# LINE member synchronization fallback

This package makes group-member synchronization safe for LINE Official Accounts that cannot call the full group-member-list endpoint.

Verified or premium accounts continue to enumerate the full group and replace the stored member map. When LINE returns the documented 403 account restriction, AM preserves the tenant-local member map learned from webhook messages and explains that each member must speak once in the group to become selectable.

New and repaired group-onboarding commands also seed the command sender's display name and LINE user ID into `成員對照`. Existing members are merged and never discarded.

No member name, user ID, group ID, tenant secret, or production row is stored in this package.
