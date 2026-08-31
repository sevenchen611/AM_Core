# AM-IMP-2026.0831.02 — Engineering contract draft and review controls

Status: Deployed

The Engineering contract workspace now supports the legal `internal_review -> draft` lifecycle transition. Returning a version does not replace its document package, bundle hash, version number, or prior draft-review evidence. The returned version can be corrected or sent through draft review again.

The workspace confirms successful submission, return, approval, and freeze actions. Draft-review failures identify whether the LINE group, Drive privacy check, source conversion, PDF renderer, Drive archive, review record, or LINE delivery failed. The workflow API writes safe operation, code, status, and message fields to application logs without tokens or contract content.

The contract overview displays `workflow_state` or latest-version evidence before a signing session exists, so HZ-CT-001 no longer appears as `尚未建版` when V1/V2/V3 records are present.

Local management, API, workspace, draft-review, store, syntax, and package checks passed. PR #57 merged as `77df870` and Render reported the deployment live at 2026-08-31 14:36 Asia/Taipei.

Production verification used HZ-CT-001 without invoking any state-changing action. The overview displayed `內部審查` instead of `尚未建版`; V3 displayed both `退回草稿` and `核准版本`; and the live script contained the internal-review success, draft-review failure, return-success, and `return-draft` endpoint markers. No LINE message was sent and V3 remained in internal review.
