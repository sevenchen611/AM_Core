# Install

1. Confirm `HZ2_FINANCE_CLAIMS_V3_RECIPIENT_BINDINGS_JSON` contains exactly one
   `group_binding` target for each accepted opaque group reference.
2. Deploy the updated AM Platform runtime from reviewed GitHub `main`.
3. Deploy the compatible Rental claim sender after AM Platform is healthy.
4. Do not mutate the recipient registry, LINE IDs, or historical event rows as
   part of installation.
