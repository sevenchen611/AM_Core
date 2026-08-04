# AM-IMP-2026.0804.01 - Claims group governance

Tenant: `hozo-am-2-0`
Status: Ready

This tenant has requested the shared `claims` module and defines a disabled-by-default claims policy. A source group becomes eligible only when its tenant-local binding is active, includes the `請款` capability, and stores selected submitters as LINE user IDs from its own member map.

The tenant configuration expects secure deployment values for the claims LIFF application, Rental base URL, AM-to-Rental token, and Rental-to-AM event token. No value, group ID, member identity, customer message, or finance record is stored here.

Before changing this record to Installed or Deployed, apply the additive schema to this tenant, configure the secure environment, select approved senders in the groups backend, and pass the AM/Rental integration smoke test.
