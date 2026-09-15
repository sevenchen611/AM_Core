# Install

1. Deploy the compatible Rental/Finance external-applicant bridge first.
2. Apply `config/claims-member-auto-onboarding.sql` to the AM claims authority PostgreSQL database.
3. Deploy the AM Platform runtime from the reviewed `main` commit.
4. Keep the existing claims-authority identity key and bridge machine credentials unchanged.

The SQL is additive and repeatable.
