# Verify

- Run the Rental legacy workflow, V3 web draft, V3 foundation and admin usage-counter tests.
- Confirm the external-template test creates no Finance V3 source membership.
- Run both AM claims dry-runs and syntax checks.
- Confirm Rental deploys before AM.
- Confirm production health endpoints return HTTP 200.
- Confirm unauthenticated Rental integration probes return HTTP 401 without a schema or timeout error.
- Use a real external LINE member as the final claim and named-template canary; do not create a synthetic financial claim in production.

