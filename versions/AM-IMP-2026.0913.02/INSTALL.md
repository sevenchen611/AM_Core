# Install

1. Start both AMCore and HOZO Rental from their latest `origin/main` in isolated feature branches.
2. Apply the protected legacy preview route and catalog links in AMCore.
3. Apply the inert `adminPreview=employee_expense` mode to Rental `finance-claims.html`.
4. Add no database migration, environment value, production identity, or claim data.
5. Run every command in `VERIFY.md` before merge.

Production merge and deployment require separate project-owner authorization.
