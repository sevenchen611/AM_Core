# Install

Apply the reviewed leaf-calendar extract, routing, store and operator-tool changes plus tests. No SQL migration or permission change is required. Deploy only reviewed GitHub main to the actual AM Platform service after CI passes.

Use live health configuredTenants to select already enrolled targets. In the verified service Shell run `node tools/retry-unprompted-calendar-previews.mjs --tenant <target> --refresh-cards` for a count-only inventory. Add `--apply --expected-commit <verified-live-40-character-commit>` to refresh legacy pending cards once. This updates presentation/revision and uses the existing worker for delivery; it does not confirm or create Google events. Newly formatted cards and closed/expired/currently leased drafts remain excluded.

Keep each project's own live records and settings local. No standalone HOZO_AM or SevenAM installation is implied.
