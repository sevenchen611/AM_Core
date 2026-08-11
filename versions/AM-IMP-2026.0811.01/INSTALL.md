# Install AM-IMP-2026.0811.01

1. Apply the shared changes to the AM Platform runtime:
   - `modules/construction/dashboard.js`
   - `modules/construction/master-data.js`
   - `modules/construction/README.md`
   - `tools/dryrun-construction-dashboard-management.mjs`
2. Confirm the engineering tenant has project-local data source configuration
   for Projects, Spaces, and Work Items. Do not copy IDs into AMCore.
3. Confirm the Spaces data source contains:
   - `名稱` (title)
   - `專案` (relation)
   - optional `區/棟` (rich text), `類型` (select), and `別名` (rich text)
4. Confirm the Work Items data source contains:
   - `工項` (title)
   - `專案` (relation)
   - `空間` (relation)
   - `工種` (select)
   - `狀態` (select)
   - `預計開始` (date)
   - `預計完成` (date)
   - optional `負責工班` (rich text)
5. Run the commands in `VERIFY.md`.
6. Deploy only from the AM Platform production project and verify against that
   project's own engineering Notion data sources.
7. Keep package status at `Ready` or `Installed` until the production Render
   service and live Notion writes are verified.
