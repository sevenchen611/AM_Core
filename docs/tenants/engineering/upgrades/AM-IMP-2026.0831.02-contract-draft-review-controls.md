# AM-IMP-2026.0831.02 — Engineering contract draft and review controls

Status: Installed

The Engineering contract workspace now supports the legal `internal_review -> draft` lifecycle transition. Returning a version does not replace its document package, bundle hash, version number, or prior draft-review evidence. The returned version can be corrected or sent through draft review again.

The workspace confirms successful submission, return, approval, and freeze actions. Draft-review failures identify whether the LINE group, Drive privacy check, source conversion, PDF renderer, Drive archive, review record, or LINE delivery failed. The workflow API writes safe operation, code, status, and message fields to application logs without tokens or contract content.

The contract overview displays `workflow_state` or latest-version evidence before a signing session exists, so HZ-CT-001 no longer appears as `尚未建版` when V1/V2/V3 records are present.

Local management, API, workspace, draft-review, store, syntax, and package checks passed. Production deployment is pending.
