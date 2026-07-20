# Verify

## Package verification

Run in AMCore:

```text
node tools/check-upgrade-package.js AM-IMP-2026.0720.03
node tools/audit-alignment.js
```

## Static and local verification

Run the equivalent checks in the target runtime:

```text
node --check core/router.js
node --check core/modules.js
node --check modules/meetings/index.js
node tools/dryrun-core.mjs
node tools/meeting-audio-tests/test-platform-sniff.mjs
```

If a project uses different vendored paths, run syntax and regression checks
against those project-local files instead.

The tests must prove all of the following:

1. A binding query includes the LINE group ID but does not include a status
   select value that may be absent from an older Notion schema.
2. An enabled binding resolves normally even when the data source has never
   created an optional shadow-status select option.
3. A returned shadow binding is routable only when that status is explicitly in
   the application allowlist.
4. A disabled or unknown-status binding is not routed.
5. Duplicate rows inside one tenant and the same group ID appearing in two
   tenants are both rejected rather than resolved by ordering.
6. A native LINE `video` event invokes the meetings media handler once.
7. A native video without a filename receives a safe `.mp4` filename.
8. Video MIME remains `video/*`, including the direct transcription fallback.
9. After meetings accepts the event, no downstream generic media handler runs
   for that same event.
10. Existing audio, named meeting-file, header-sniffed file, and non-meeting-file
   cases retain their expected behavior.

## Production smoke test

Use a target-local, authorized test group and non-sensitive test media:

1. Confirm an enabled bound group still resolves to the correct tenant.
2. Send one native LINE video containing speech. Confirm the bot acknowledges
   meeting intake and asks for the expected meeting details exactly once.
3. Complete the meeting flow and confirm the record remains inside that target's
   own storage and task system.
4. Confirm the same video was not also processed as a generic media attachment
   or event.
5. Confirm a disabled group and an unbound group remain ignored.
6. Review logs for routing errors, duplicate processing, content-download 202
   exhaustion, transcription errors, and cross-tenant access rejection.

Do not use customer recordings, real credentials, production IDs, or private
group contents as fixtures in shared tests or upgrade records.
