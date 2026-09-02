# AM-IMP-2026.0902.12 - Contract-specific Party A dual signing

Individual Party A profiles no longer store a reusable signature. The profile
keeps identity and address data only. After Party B completes the existing LINE
electronic-signature flow, an authorized internal confirmer must capture Party
A's signature for that contract before confirmation and final archiving.

The Party A signature is stored as an immutable, private Drive artifact tied to
one contract version and one signing session. The final PDF and evidence receipt
contain separately verifiable Party A and Party B signature hashes. Company
Party A profiles continue to use the frozen large company seal.
