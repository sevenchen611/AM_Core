# AM-IMP-2026.0921.02

Status: Ready

External vendor claim groups use the claims authority registry as their single AM
authorization source. The selector and every protected legacy LIFF action still
revalidate the active group, OA presence, observed applicant, individual deny
state, published form, session expiry and original LINE user, but they no longer
dereference a Notion group binding that external groups do not require.

Internal and non-authority legacy flows retain their live Notion checks. Rental's
canonical source id and opaque group reference contract is unchanged. There is no
schema, environment, membership or financial-data change.
