# Rollback - AM-IMP-2026.0804.01

To stop new claim intake safely:

1. Set the target tenant `config.claims.enabled` to `false` and deploy that configuration.
2. For any affected source group, remove `請款` from `啟用功能` or change `請款送件權限` to `停用`.
3. Keep existing group bindings, member maps, claim records, Rental records, and audit data intact for review.
4. Rotate the two machine tokens if a callback or credential incident is suspected.
5. Mark the target project's manifest entry `Blocked` or `Ready` with the reason; do not mark it `Deployed` until the repaired project service is verified.

Do not delete schema fields during an incident. They are additive and retaining them preserves configuration evidence. Re-enable only after the claims module, Rental endpoint, and group-authority checks pass again.
