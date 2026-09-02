# AM-IMP-2026.0902.11 - Contract LINE provider alignment

Status: Deployed

## Root cause

The production contract LIFF app and the Messaging API channel used for the
Engineering group were under different LINE Developers providers. LINE issues
different user IDs to the same person across providers, so a valid LINE Login
identity could not match the group-member identity and was rejected as not in
the group.

The contract-to-group binding itself was correct. The target demolition group
was active and its tenant-local member map already contained the affected
operator; no group, signer, contract, or member data was rewritten.

## Correction

- Added a dedicated Full-size contract-signing LIFF app to an existing published
  LINE Login channel under the same provider as the production Messaging API
  channel.
- Configured the exact production signing endpoint with `openid` and `profile`
  scopes and the add-friend option disabled.
- Updated only the project-local `ENG_CONTRACTS_LIFF_ID` Render environment
  value and rebuilt the existing `am-platform` service.
- Render deployment `dep-dac03dbtqb8s73dorh6g` reached Live at commit
  `ecba349`.
- Configuration, verification, and rollback evidence is recorded in PR #107.

No production LINE, LIFF, group, or user identifier is committed in this
record.

## Verification

The original issued demolition-contract link was reopened from the authenticated
external Chrome session as a known current group member who is not the
designated signer. LINE Login used the corrected channel, the server accepted
the exact current group membership, and the page displayed verified read-only
access with the protected PDF control. Signing fields remained unavailable.

No invitation was resent, no signature was submitted, no contract state was
changed, and no LINE message was created during verification.
