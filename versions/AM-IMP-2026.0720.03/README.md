# AM-IMP-2026.0720.03 — LINE meeting media intake reliability

Status: **Ready**
Depends on: **AM-IMP-2026.0720.01**

This portable upgrade makes meeting-media intake reliable across AM Platform and
project-local AM runtimes. It addresses two independent failure modes that can
otherwise look identical to a user: a bound LINE group appears unbound, or a
video is visible in LINE but never starts the meeting-record workflow.

## Improvements

### 1. Group routing does not depend on undeclared Notion select options

The group-binding lookup queries Notion by LINE group ID only. The runtime then
accepts only one unambiguous record whose returned status is explicitly
routable, such as `啟用` or `影子記錄`, and continues to reject disabled records.
Duplicate rows inside one tenant, the same group ID appearing across tenants,
or an incomplete tenant lookup all fail closed.

This avoids sending a Notion query filter containing a select value that an
older project-local Group Bindings data source has not created yet. Notion
validates select values before running the query; one missing option could
previously make the whole query fail and cause an enabled group to be treated as
unbound.

The change does not broaden authorization. Tenant isolation, group-ID matching,
runtime enablement, and the application-side status allowlist remain mandatory.

### 2. Native LINE video enters the meeting pipeline exactly once

LINE sends native video, audio, and file uploads as different webhook message
types. The shared dispatcher and meetings module now treat native `video` as a
valid meeting-media source, assign a safe `.mp4` filename when LINE supplies no
filename, and preserve a video MIME type for transcription fallbacks.

After a meetings handler accepts audio, video, or a recognized meeting file, it
returns a handled result so downstream generic media modules do not process the
same upload again. Existing audio messages, recognized audio-file extensions,
and header-sniffed files keep their existing behavior.

## Scope and boundaries

- Install targets: AM Platform, BuildAM, HOZO AM, SevenAM, and new AM projects.
- No new database, schema migration, or environment variable is required.
- No LINE group ID, Notion ID, credential, recording, transcript, customer
  message, or other operational data belongs in this package.
- Each installation uses its own LINE channel, tenant configuration, Notion
  sources, deployment, tests, manifest, and upgrade record.
- Production status must remain project-local; this shared package is `Ready`,
  not proof that any target has been deployed.
