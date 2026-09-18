# Install

Merge the reviewed AM Platform PR to GitHub main and allow the existing Render
main deployment. Do not install this HOZO-specific routing change into standalone
HOZO_AM or SevenAM services. Existing claims authority configuration is required;
no new environment variables or migrations are introduced.

Deploy the AM receiver before enabling the Rental v2 producer. Both v1 and v2
remain supported. Verify the existing canonical finance group and the first
approver's already verified opaque recipient reference from the claims policy.
Profile names are display labels, not identity credentials. Legacy missing member
metadata can only use the existing explicit tenant/User-ID recipient binding;
conflicting stored references or tenant metadata stay blocked. No new bindings
are generated and no memberships/identities are rewritten.
Do not equate nicknames/admin usernames with full names or copy raw LINE IDs.
Observe existing pending notifications; do not invoke bank creation/review/release.
