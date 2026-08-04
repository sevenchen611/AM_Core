# AM-IMP-2026.0804.01 - Claims group governance

Tenant: `hozo-am-2-0`
Status: Deployed

This tenant has the shared `claims` module enabled for the separately provisioned source group. A source group remains eligible only when its tenant-local binding is active, includes the `請款` capability, and stores selected submitters as LINE user IDs from its own member map.

The tenant configuration expects secure deployment values for the claims LIFF application, Rental base URL, AM-to-Rental token, and Rental-to-AM event token. No value, group ID, member identity, customer message, or finance record is stored here.

Production verification completed: the additive schema, secure environment, approved senders, Rental claim intake, source configuration, and approver configuration are in place. The first live LINE claim remains the operational end-to-end check.
