# Install

1. Start from the latest `AM_Core` `origin/main` in an isolated feature branch.
2. Apply the catalog and navigation changes in `core/claims-authority-admin.js`.
3. Apply the catalog assertions in `tools/dryrun-claims-authority-admin.mjs`.
4. Do not add a database migration or production data; this version is read-only UI.
5. Run every command in `VERIFY.md` before merge.
6. Install into HOZO AM separately. Do not copy HOZO labels into SevenAM without a
   separate reviewed form inventory.

Production merge and deployment are outside this package installation unless the
project owner explicitly requests them.
