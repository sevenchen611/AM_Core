# Install

Install this version separately in each target. Do not copy project-local data,
configuration, or deployment state between AM Platform, BuildAM, HOZO AM, and
SevenAM.

## Prerequisite

1. Confirm `AM-IMP-2026.0720.01` is installed or its meeting-review contract is
   already present in the target runtime.
2. Read the target project's current improvement manifest and identify whether
   it uses AMCore directly, a vendored module copy, or a project-local runtime.
3. Preserve unrelated local changes. Apply only the equivalent behavior below.

## Runtime changes

1. Update the target's group-binding router:
   - query the project-local Group Bindings source by LINE group ID;
   - do not put optional or not-yet-created Notion select values into the query;
   - query every runtime-enabled, configured tenant before deciding ownership;
   - route only when exactly one tenant contains exactly one matching row and
     that row's status is on the runtime's explicit routable-status allowlist;
   - fail closed when one tenant returns multiple rows for the same group ID,
     when the group ID appears in multiple tenants, or when any tenant lookup
     fails; do not cache lookup-error results;
   - continue to reject disabled and unknown statuses;
   - keep every query tenant-locked and use a result limit of at least two so a
     duplicate can be detected.
2. Update the target's message dispatcher:
   - recognize native LINE `video` alongside existing audio and meeting-file
     candidates;
   - assign `video-<message-id>.mp4` when a native video has no filename;
   - continue sharing the meeting-media classification through the event
     context so collection modules do not upload it as a generic attachment.
3. Update the target's meetings handler:
   - accept native LINE video;
   - preserve `video/*` MIME types and use `video/mp4` when LINE has not supplied
     a usable type;
   - keep existing audio MIME normalization for audio and file sources;
   - return `true` after accepting and staging or directly processing meeting
     media, so later generic media handlers do not receive the same event;
   - isolate acknowledgement-push failures after staging, so a failed LINE
     acknowledgement does not cause the same media to fall through to another
     module.
4. Install equivalent regression tests for group routing, native video intake,
   safe filename/MIME handling, and downstream short-circuit behavior.

Canonical AM Platform paths are:

```text
core/router.js
core/modules.js
modules/meetings/index.js
tools/dryrun-core.mjs
tools/meeting-audio-tests/test-platform-sniff.mjs
```

BuildAM, HOZO AM, and SevenAM may use vendored or project-local paths. Adapt the
behavior to those paths; do not replace an entire project module with another
project's copy. New AM projects should inherit the corrected shared runtime
template before receiving any tenant-local configuration.

## Records and status

1. Run the checks in `VERIFY.md` in the target project.
2. Create the target's own `docs/upgrades/` record.
3. Update the target's own improvement manifest to `Installed` only after local
   verification passes.
4. Deploy from the target project's own service and mark it `Deployed` only
   after the production smoke test passes.

No new database, Notion option, environment variable, secret, or data migration
is required by this package.
