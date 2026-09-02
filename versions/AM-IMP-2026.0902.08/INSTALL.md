# Install

1. Deploy the runtime files from this package to Engineering AM.
2. Apply `schemas/engineering-contract-party-a-profiles-v6.sql` to the dedicated
   Engineering contract PostgreSQL database with `runtime_role` set to the
   existing restricted runtime role.
3. Confirm `schema_meta.version` is
   `2026-09-02.engineering-contract-evidence.v6`.
4. Open `/contracts?tenant=engineering` with contract-management permission and
   create the required Party A profiles from the user's source folder.
5. Upload company seals as PNG/JPEG under `公司大章` and `負責人小章`; upload
   personal signatures under `個人簽名`.
6. Do not place the source files or real profile values in this repository.

Production deployment and importing real signing assets require explicit
project-owner authorization and are not performed by package installation.
