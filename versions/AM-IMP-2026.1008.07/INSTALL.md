# Install

1. Verify latest production AM main commit and the target's full published DailyLog module. Preserve other uncommitted work.
2. Prepare and test the target's isolated fixed release, additive intake schema, dedicated service secret and unchanged runtime bindings. Never reuse a Calendar key.
3. Review and merge this AM source to GitHub main, then verify the live commit.
4. Deploy the tested DailyLog counterpart with the original assets and bindings preserved. Apply only the additive intake schema in the target's D1.
5. Configure `/portal/admin/leaf-tasks/service` with the existing channel-derived `leaf-task-admin-v1` purpose token and the target-specific tenant, HTTPS origin and dedicated task key. Configuration validates the target contract and explicitly adds two service configuration columns through the tenant's existing migration connection. No schema is changed at boot.
6. Verify full target module, assets, scopes, configured tenant and unauthorized access rejection. Keep private backup and service setup material at the original targets. Register target-specific installation and deployment receipts.

Green Hotel groups with existing routable 啟用 or 影子記錄 bindings are eligible after explicit tenant enrollment; this authorization activates only this new mention assignment path. It does not change other shadow-mode module policies or grant anyone new business access.
