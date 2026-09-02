# Contract LINE provider alignment

Engineering contract signing combines LINE Login/LIFF identity with Messaging
API group membership. LINE user IDs are provider-scoped, so both channels must
belong to the same LINE Developers provider. A LIFF app under another provider
will produce a different user ID for the same person and make the group-member
profile lookup fail closed.

This package records the deployment guard and the production correction. It
does not contain a channel ID, LIFF ID, group ID, user ID, access token, signing
token, or contract record.

The security model is unchanged: a current group member may read the protected
contract, while only the designated signer may submit identity data or a
signature.
