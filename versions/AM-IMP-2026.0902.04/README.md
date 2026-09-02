# AM-IMP-2026.0902.04 - Contract workflow timestamp normalization

PostgreSQL returns `timestamptz` transition evidence as JavaScript `Date` objects. The contract-management service previously compared those objects, after generic string conversion, with the ISO timestamp it sent to the store. The database transition committed successfully, but the response verifier then reported an adapter violation and the UI displayed a false workflow failure.

This package normalizes returned workflow timestamps to ISO text before the immutable-content and transition-evidence checks. Draft submission, approval, freeze, and other existing version-state safeguards remain unchanged. No tenant data, contract content, or credentials are included.
