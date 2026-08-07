# AM-IMP-2026.0807.01 - Private LINE claims entry

Tenant: `hozo-am-2-0`

The existing 葉小蝸 Rich Menu text action `我要請款` now enters the claims
module through the tenant-safe one-to-one dispatcher. The module creates a new
signed LIFF session only after the exact LINE user ID has exactly one active,
claim-enabled, allowlisted source binding.

The menu does not store a reusable form token. No approval, payment, or release
action is added. Live verification must stop after the form opens and displays
the expected source.
