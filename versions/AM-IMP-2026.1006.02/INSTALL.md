# Install

1. Apply the changes to `modules/personal-assistant/index.js` and `tools/dryrun-personal-line-routing.mjs` in the root AM Platform runtime.
2. Run the checks in VERIFY.md. Retain `personalAssistant.enabled=true` for tenants using private task commands.
3. Review and merge the tested change to GitHub main before using the platform's production deployment workflow. Do not deploy a dirty checkout or feature branch.
4. Verify the actual target service and record its deployed commit before setting status to Deployed.

Do not install into standalone HOZO_AM or SevenAM repositories automatically. Apply compatible shared code separately only if requested; retain their own secrets, records and manifests.
