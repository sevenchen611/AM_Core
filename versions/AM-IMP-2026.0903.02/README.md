# AM-IMP-2026.0903.02 Engineering Contract Control State

This package adds a deterministic, pure read model for Engineering contract
control. It derives independent Party A, Party B, internal-confirmation and
archive progress from immutable signing evidence and frozen contract versions.

A legacy aggregate `signed` value can never hide a missing Party A signature.
Company Party A seal evidence is explicitly distinguished from an individual
Party A online signature.
