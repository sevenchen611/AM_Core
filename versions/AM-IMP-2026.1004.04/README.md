# AM-IMP-2026.1004.04 — Reliable tenant attachment preservation

An active tenant without the Engineering-only archive opt-in could index a large
PDF, CAD file or video without retaining any binary. Collect skipped Notion previews
above 20 MiB or for unsupported formats, backed up only images, and still logged
an attachment as stored. LINE content can expire before anyone notices.

Original retention is now the baseline for every active collect tenant. Group/room
images, ordinary files and videos get a tenant-local durable Notion queue row before
webhook acknowledgement. Drive receives originals as streams independently of
preview support. Saved status requires a Drive metadata read confirming the tenant,
destination folder, exact size and MD5 checksum. The streaming source SHA256 and
storage MD5 are preserved in the tenant index. Optional previews cannot invalidate originals.

The index records source message/group IDs, attempts, next retry, saved time and
explicit state. Work starts immediately, resumes after restart, and polls every
minute. Transfers retry up to eight attempts; expired LINE content is `需要重傳`,
other exhausted failures are `保存失敗`. Notion and health expose unsuccessful saves.
Active source groups receive one failure warning and a recovery notice when needed;
notifications use persisted state and LINE retry keys. Shadow/re-bound groups are
never notified. Historical repairs can suppress group notices with the `legacy` marker.
If LINE expires, a matching Notion-managed original can still be copied to Drive;
arbitrary external file URLs are not accepted as archive inputs.
Retry lookup by tenant/message identity recovers upload-success/index-failure cases.
In-process locks prevent overlapping work. Notion has no uniqueness constraint;
keep one service instance until a database lease supports horizontal scaling.

Known meeting audio retains its existing archive workflow. Unbound groups, private
chats and LINE I/O transport-only traffic retain their established routing. This
upgrade cannot recover expired historical binaries. The audit is read-only.

References: [Notion single-part upload](https://developers.notion.com/guides/data-apis/uploading-small-files),
[LINE content retention](https://developers.line.biz/en/reference/messaging-api/#get-content).
