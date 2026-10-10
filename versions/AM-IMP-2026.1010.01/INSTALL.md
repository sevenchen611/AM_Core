# Install

Apply the changes in `core/central-archive/store.js` and `core/leaf-calendar/extract.js` together with their regression tests to the AM Platform root runtime. Existing JSONB schema is sufficient; no migration, secret change or record rewrite is needed.

Run VERIFY before review. Production installation uses a reviewed commit merged to GitHub main and the actual AM Platform service. Preserve the paused general private assistant and current tenant configuration. Existing unprompted drafts retain their source, revision and retry key and become deliverable on their next scheduled retry.

Do not copy bindings, accounts or drafts to HOZO_AM or SevenAM. Any standalone adaptation requires separate installation and project-local manifest evidence.
