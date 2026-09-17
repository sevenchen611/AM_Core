# Install

1. Apply the listed runtime files and tests to the reviewed AM Platform source.
2. Verify existing tenant-local message/attachment data sources and private Drive archive configuration. Do not copy credentials or production identifiers into AMCore.
3. Run VERIFY.md before rollout. Merge reviewed source to main before production deployment; never deploy this feature branch directly.
4. Verify the Engineering workspace and a valid group-authenticated contract link read-only. Do not select/import customer files as an automatic deployment test.

No database migration is required. Older LINE files without an archived original remain visible but unavailable for import and must be uploaded again.
