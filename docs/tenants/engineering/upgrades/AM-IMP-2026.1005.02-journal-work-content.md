# Engineering journal work content and multiple areas

Status: Deployed

The user requested merging crew intake into each work entry, replacing the crew selector with an editable engineering name, recording people per work, and combining space/location as a checkbox dropdown at the end of each entry. They explicitly confirmed summed person-times across work entries.

The new work-content-v2 format preserves engineering names and people separately from legacy crew fields. Multiple same-project areas are linked to the report without editing planned work-item spaces. Old crew journals, source evidence, photos, financial permissions and latest work-date progress remain supported. No database/environment change is required.

Validation: 21 journal tests, 14 dashboard checks, 12 construction checks, 18 engineering convergence checks and synthetic browser two-entry/multi-area submission passed. Production IDs, credentials, screenshots and user drafts stay outside AMCore.

Production verified on 2026-10-05: PR #238 merged as af88c41d35f433382ddf2df9a2f525b692beb3af and Render deployment dep-db1im0uq1p3s73fbq700 reported Live. Health matched that commit with all three journal sources and isolation enabled; unauthenticated journal project access returned HTTP 401. No schema, environment value or instance count changed.

Authenticated synthetic submission saved two separately named work entries, with six and three people, and displayed nine person-times. The first work recorded two areas and one photo; its original work-item modal displayed the engineering name, six people and both area names below existing fields. The live verifier confirmed engineeringNameSaved, multiAreaLinked and nativeReverseRelation. Cleanup archived synthetic Notion pages and trashed only their unique Drive case directory, both recoverable. User drafts were preserved separately and were not submitted as reports.

Alignment audits still report pre-existing HOZO/Seven gaps, with no error for this package or Engineering; no global alignment completion is claimed.
