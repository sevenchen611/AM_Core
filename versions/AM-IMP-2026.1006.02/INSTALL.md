# Install

1. Apply the changes to `core/direct-line.js`, `server.js` and verification tools in the root AM Platform runtime.
2. Run the checks in VERIFY.md. Keep the platform switch `PERSONAL_ASSISTANT_ENABLED=false`. Tenant settings and data remain available for later resumption.
3. Review and merge the tested change to GitHub main before using the platform's production deployment workflow. Do not deploy a dirty checkout or feature branch.
4. Verify the actual target service and record its deployed commit before setting status to Deployed.

Do not install into standalone HOZO_AM or SevenAM repositories automatically. Apply compatible shared code separately only if requested; retain their own secrets, records and manifests.
