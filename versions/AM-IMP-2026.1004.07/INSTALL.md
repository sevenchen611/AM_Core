# Install

1. Apply the shared service, server integration, transport reservation and tests
   listed in upgrade.json to the reviewed AM Platform source.
2. Verify each enabled tenant separately has its own configured message and
   attachment data sources, Drive root and AM-IMP-2026.1004.06 saved indexes.
   No schema or credential changes are required. Do not enable disabled tenants.
3. Run VERIFY.md and update each tenant's manifest and upgrade record as Installed.
4. Review the PR, require passing CI, merge into GitHub main and verify the target
   production health commit and retrieval contract before recording Deployed.

Standalone HOZO_AM and SevenAM installations remain separate. This Platform
adapter is not a claim that unavailable standalone services were installed.
