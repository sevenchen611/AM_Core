# AM-IMP-2026.0921.02

Status: Deployed

External vendor claim groups use the claims authority registry as their single AM
authorization source. The selector and every protected legacy LIFF action still
revalidate the active group, OA presence, observed applicant, individual deny
state, published form, session expiry and original LINE user, but they no longer
dereference a Notion group binding that external groups do not require.

Internal and non-authority legacy flows retain their live Notion checks. Rental's
canonical source id and opaque group reference contract is unchanged. There is no
schema, environment, membership or financial-data change.

Production deployment completed on 2026-09-21:

- AM Platform PR #192 merged as `7c680f2cd09058e1dab4744e394080c038e1559b`.
- Render deployment `dep-daoe2h8jo6nc73a8m5f0` reached Live in 32.7 seconds.
- Production health returned HTTP 200 at the deployed commit with the HOZO AM 2.0 runtime enabled, authorization ready and the claims module loaded.
- No synthetic financial claim or external LINE message was created during deployment verification. A real vendor opening a newly requested form remains the final user canary.
