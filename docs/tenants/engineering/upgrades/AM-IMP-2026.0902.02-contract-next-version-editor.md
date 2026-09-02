# AM-IMP-2026.0902.02 - Engineering install record

Status: Deployed

Adds a next-version editor that visibly carries forward the effective contract body, construction drawings, quotation, payment milestones, and acceptance criteria. Managers only upload a document when it changes. Structured payments become the single source rendered in Article 5; project-specific acceptance criteria are rendered in Article 10 while the contract's general inspection procedure remains. Historical inherited files stay immutable and indexed without being repeatedly appended to the current PDF.

No database migration, password rotation, environment change, contract mutation, or LINE delivery is required for installation.

Production evidence:

- PR #87 deployed the next-version editor and single-source PDF clauses; PR #88 added legacy effective-document promotion.
- Runtime commit `1d21898` is Live in Render deployment `dep-dabphu15efls739t03m0`.
- `https://am.hozorental.com/health` returned HTTP 200 with the Engineering tenant runtime, authorization, Notion, routing, Drive, and construction module ready.
- The authenticated HZ-CT-001 V11 composer displayed the V10 contract body, V10 construction drawing, legacy V1 quotation, carried payment milestone, and carried acceptance criterion.
- Production verification was read-only: V11 was not saved, no attachment was replaced, and no LINE message or signing action was triggered.
