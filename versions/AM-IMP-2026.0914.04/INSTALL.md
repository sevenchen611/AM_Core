# Install

1. Merge and deploy the Rental Management change first, including migration `0078_finance_claim_legacy_form_versions.sql`.
2. Verify the bearer-authenticated form-history endpoint for tenant `hozo`.
3. Merge and deploy the AM Platform change.
4. In AM claim management, formally publish the second form with zero assigned groups only after action-time confirmation.
5. Do not delete legacy forms or rewrite existing claim rows.
