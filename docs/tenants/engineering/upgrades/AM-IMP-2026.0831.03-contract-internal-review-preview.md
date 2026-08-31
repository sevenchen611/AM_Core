# AM-IMP-2026.0831.03 — Contract internal review preview

Status: Deployed

Engineering AM now exposes a read-only merged PDF and separately protected source attachments inside the contract workspace. Access uses the existing Engineering tenant, project scope, and `view` capability. The merged PDF is generated on demand with a draft watermark and prior review feedback.

No schema, secret, LINE delivery, workflow transition, or signing-evidence change is part of previewing a document.

Production evidence: PR #59 merged as `9f68613` and Render reported the matching deployment live. HZ-CT-001 V3 displayed the read-only internal-review panel, the merged-PDF link, and three protected attachment links for the contract body, construction drawing, and quotation. Verification used only page reads and did not approve, return, issue, sign, or send LINE.
