# Engineering journal work content and multiple areas

Status: Installed

The user requested merging crew intake into each work entry, replacing the crew selector with an editable engineering name, recording people per work, and combining space/location as a checkbox dropdown at the end of each entry. They explicitly confirmed summed person-times across work entries.

The new work-content-v2 format preserves engineering names and people separately from legacy crew fields. Multiple same-project areas are linked to the report without editing planned work-item spaces. Old crew journals, source evidence, photos, financial permissions and latest work-date progress remain supported. No database/environment change is required.

Validation: 21 journal tests, 14 dashboard checks, 12 construction checks, 18 engineering convergence checks and synthetic browser two-entry/multi-area submission passed. Production verification remains before marking Deployed. Production IDs, credentials, screenshots and user drafts stay outside AMCore.
