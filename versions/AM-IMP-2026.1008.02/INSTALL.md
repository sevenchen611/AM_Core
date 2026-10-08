# INSTALL

1. Apply the reviewed native core/server changes on current GitHub main. Install existing dependencies with npm ci --ignore-scripts.
2. Keep the existing configured central archive, selected OA, PostgreSQL, owner Notion parent and Google Drive root. No new secrets, permission grants, schema or project-group activation are required.
3. Run VERIFY checks. Production deploy must use reviewed, merged main for the AM Platform Render service.
4. Record each active platform tenant's installation/deployment separately. Do not apply to legacy HOZO_AM or SevenAM bots without adapting and verifying their own runtime.
