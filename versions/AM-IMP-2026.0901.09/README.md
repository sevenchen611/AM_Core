# AM-IMP-2026.0901.09 - Contract attachment opening and immutable exclusion

Engineering contract attachment and LINE archive routes now bind their own path identifiers instead of incorrectly comparing them with the contract-version identifier. This removes the `PATH_BODY_REFERENCE_MISMATCH` failure that prevented every protected V4 attachment from opening.

Managers also receive a hover or touch-visible × control beside each attachment. Confirming removal creates the next immutable draft version with a persistent exclusion tombstone. Historical versions and the private Drive source remain unchanged, while later versions continue honoring the exclusion so duplicate files do not reappear.
