# Individual Party A online signing

When the frozen contract identifies Party A as an individual, issuance now
requires two distinct LINE signers from the contract's authoritative LINE
group: one for Party A and one for Party B. Both use the same protected link,
but each account sees and can submit only its own signing role.

Party A signs the exact frozen document in a dedicated large signing field.
The signature is stored as private, immutable evidence for that version and
session. It is not written back to the Party A profile and cannot be reused in
another contract. Company Party A contracts continue to use their frozen large
company seal.

The final internal confirmation now verifies that both online signatures exist
for an individual Party A before it creates the final PDF and evidence receipt.
Existing active individual contracts can bind Party A to the current signing
session without reissuing or changing the frozen PDF.
