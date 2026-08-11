# AM-IMP-2026.0811.01 Engineering Dashboard Master Data Creation

This package adds project-scoped master-data controls to every project card in
the engineering dashboard.

Users with engineering dashboard access can now:

- create a Space related to the currently selected project;
- create a Trade option in the tenant-local Notion Work Items data source;
- create a scheduled Work Item related to the current project and one of its
  own spaces;
- refresh the project detail, Gantt chart, and space-by-trade matrix immediately
  after a successful write.

All writes use the current tenant's configured Notion data sources. The server
revalidates project scope, data-source ownership, and the space-to-project
relation before creating a page. No Notion IDs, project records, or secrets are
stored in this package.

## Status

`Ready`: shared implementation and mock verification are complete. Production
deployment and live Notion proof must be performed from the AM Platform project
and Render service before this package can be marked `Deployed`.
