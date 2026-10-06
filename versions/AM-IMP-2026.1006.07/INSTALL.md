# Install and activate

1. Run VERIFY.md and merge reviewed code to main. The authenticated shared service setup can apply the reviewed additive schema using migration/runtime credentials already held by the server. It checks that the runtime role cannot bypass RLS. There is no automatic boot migration. Alternatively apply schema locally from that reviewed revision using the requested tenant's own credentials:

~~~text
node --env-file=<project-local-env> tools/install-leaf-calendar.mjs <tenant-key>
node --env-file=<project-local-env> tools/install-leaf-calendar.mjs <tenant-key> --apply
~~~

2. Deploy reviewed main. Verify /health reports lineCalendar.contract=line-confirmed-dailylog-shared-calendar-v2 and the provisioned tenant. If boot preceded schema installation, restart reviewed main.
3. Read the supplied private shared service env through the setup CLI. Never copy it into this repository or print its values:

~~~text
node --env-file=<project-local-env> tools/enroll-leaf-calendar.mjs --service-env <private-service-env> --tenant <tenant-key> --platform-base <production-AM-HTTPS-origin>
~~~

4. The CLI installs the shared service once through a purpose-specific authenticated setup endpoint. It checks API authentication using an intentionally invalid empty body (400 INVALID_REQUEST), which creates no event. The service key is encrypted in the tenant-local database; regular users receive no key or calendar pairing code. Verify configuredTenants in live health.
5. Users keep their existing verified UOF direct LINE binding and DailyLog Google authorization/calendar selection. Mapping is obtained from LINE IO, never guessed from names or extracted from chat text. Unbound or group-bound users must complete the existing UOF direct binding flow before using private calendar intake.
6. Send activity text, review the four fields, optionally supplement it, and explicitly press 加入行事曆. 查看行事曆草稿 redisplays pending cards. 不加入 cancels the draft. Revoking the existing UOF binding stops future authorized intake/writes.

No production entry is created by installation. For shared key rotation reinstall the updated private env; retries retain their frozen account/body/request ID. If UOF identity or service origin changes, older drafts require new intake and confirmation. Standalone HOZO/Seven installation remains separate and is not implied by this root platform rollout.
