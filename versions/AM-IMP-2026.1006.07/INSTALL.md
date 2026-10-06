# Install and activate

1. Run VERIFY.md and merge reviewed code to main. Apply from that revision only.
2. Provision each requested tenant separately using its own migration/runtime database settings. No other project receives credentials or records:

```text
node --env-file=<project-local-env> tools/install-leaf-calendar.mjs <tenant-key>
node --env-file=<project-local-env> tools/install-leaf-calendar.mjs <tenant-key> --apply
```

3. Verify live `/health` reports `lineCalendar.contract=line-confirmed-dailylog-calendar-v1` and the provisioned tenant. If code started before schema creation, restart the reviewed main service.
4. In the production DailyLog account, connect Google persistently, choose an editable calendar and create the dedicated `dlcal.` key. Local and production keys/Google grants are separate. Save the key in a private file outside all repositories; never paste it into a conversation or tracked file.
5. Enrollment uses the same deployment's existing LINE channel secret for a purpose-specific setup credential. The supplied origin is trusted administrator configuration, never derived from LINE text or AI output:

```text
node --env-file=<project-local-env> tools/enroll-leaf-calendar.mjs --key-file <private-file> --tenant <tenant-key> --dailylog-base <production-DailyLog-HTTPS-origin> --platform-base <production-AM-HTTPS-origin>
```

6. Give the returned command to its intended human only. They send `綁定行事曆 LC1.…` in their LINE one-to-one chat within ten minutes. No arbitrary LINE user/account/calendar identifiers can be supplied in activity text. Enrollment validates auth using an intentionally invalid empty event body: the API must return `400 INVALID_REQUEST`, without creating an event.
7. The user sends activity text, reviews all four fields, optionally supplements it, and explicitly presses 加入行事曆. Source and confirmation are retained. Use 查看行事曆草稿 to redisplay pending cards and 解除行事曆綁定 to stop future intake.

A profile bound to a different tenant cannot silently overwrite that assignment. Former pending items must be reviewed anew after binding/key changes. API target changes happen in DailyLog by issuing and pairing a new key.
