# Install

1. Deploy `modules/collect/index.js` and `tenants/engineering.json` together.
2. Confirm the production engineering tenant has its existing attachment data
   source, Drive root, Google OAuth, LINE, and Notion environment values.
3. Confirm `config.attachments.archiveAllLineGroupAttachmentsToDrive` is `true`.
4. Run every command in `VERIFY.md`.
5. After deployment, send a small PDF, DWG, image, and short video to a designated
   Engineering AM canary group. Verify every attachment row has an openable
   `Drive 連結`; PDF/image may also have a Notion preview.
6. Mark `Deployed` only after the production Drive files and source relations are
   verified. Do not copy production IDs, records, files, or secrets into AMCore.
