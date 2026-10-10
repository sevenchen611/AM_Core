# Shared LINE JSON delivery fix

Status: Deployed in the root AM Platform runtime, verified 2026-10-10. Reviewed PR #276 main `aedbf53a1082fe345df32ecef262ff4f9a6755fe` is live on Render deploy `dep-db4soguk1f9s73dqheog`; shared archive health is active and ready.

Optional undefined fields are normalized to HTTP JSON before evidence storage and replay comparison. Common user/group/room push and reply tests passed, preserving rejection of changed retry content. This tenant inherits the shared transport fix. Calendar enrollment remains unchanged; production health still lists the originally enrolled tenant only. No permissions or business data changed, and no test message was sent to this tenant.
