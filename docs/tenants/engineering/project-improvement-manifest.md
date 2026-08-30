# Engineering AM — Project Improvement Manifest

Tenant key: `engineering`  
Environment prefix: `ENG`  
Runtime target: `AM_PLATFORM`

| Version | Status | Capability | Scope | Notes |
| --- | --- | --- | --- | --- |
| AM-IMP-2026.0828.01 | Ready | Engineering contract management and immutable electronic-signing evidence | Graphical contract workspace, independent contract-template V1/V2/V3 library, project-local contract versions, dedicated PostgreSQL evidence schema, Drive artifacts, LINE-group LIFF signing and evidence PDF | Production schema v2 and the template-library UI are deployed and verified. Standard templates do not create or bind a project contract; applying one copies its exact file/hash into a separate project contract version. Signing remains disabled pending trusted-proxy request evidence, a restore/hash drill, and one controlled LINE-group pilot. |
| AM-IMP-2026.0828.02 | Deployed | Engineering AM LINE group self-onboarding | Explicit Engineering tenant aliases, tenant-safe Group Bindings creation, active engineering defaults, and post-bind project/role/trade guidance | PR #32 merged as `fe132c0`; production `/health` reports `engineering-group-onboarding-2026-08-28`, LINE configured, and Engineering authorization, Notion, routing, and all requested modules ready. The group owner must resend the command in the target LINE group and then assign its Engineering project, role, and trade. |
| AM-IMP-2026.0828.03 | Deployed | LINE member synchronization fallback | Preserves webhook-observed group members when LINE blocks full member enumeration and seeds the onboarding sender | PR #35 merged as `8bbf2e7`; the 11-field Engineering Group Bindings V2 patch is live, production limited-mode sync returns guidance instead of 403, and existing webhook-observed member maps remain intact. The new group stays at 0 until a member sends a new LINE message or the onboarding command is resent. |
| AM-IMP-2026.0828.05 | Deployed | Engineering contract draft review | Incomplete-draft PDF, LINE-group discussion link, reviewer feedback evidence, and V1/V2/V3 review history separated from formal signing | PR #40 merged as `4b1eb0e`; Render deployed the commit, PostgreSQL schema v3 and restricted grants passed production checks, and the public review page plus internal draft-send control were verified. No real LINE message was sent during deployment. |
| AM-IMP-2026.0830.01 | Deployed | Engineering draft-review status hotfix | Unambiguous PostgreSQL send/open transitions and evidence-preserving recovery | PR #42 merged as `9edb718`; Render deployed it live. The provider-accepted HZ-CT-001 review was restored from `created` to `sent` with its original send evidence and no duplicate LINE message. The production open-transition SQL parsed successfully inside a rolled-back verification transaction. |
| AM-IMP-2026.0830.02 | Deployed | Engineering contract inline attachment review | Merged on-page draft preview plus separate protected original-attachment controls | PR #44 merged as `4f2c48b` and Render deployed it live. Production serves the inline-preview iframe and original-attachment controls; the composite PDF regression appends all PDF pages and image pages while preserving private Drive and SHA-256 checks. Existing review links use the feature without reissue or duplicate LINE delivery. |
| AM-IMP-2026.0830.03 | Deployed | Engineering draft-review feedback presentation | Complete feedback on the public page and Engineering AM, with review-linked next-version creation | PR #46 merged as `e8cd9f6` and Render deployed it live. Production verification confirmed the public response section and the Engineering AM full-feedback, next-version, and revision-source controls. |
| AM-IMP-2026.0830.04 | Deployed | Mobile contract PDF attachment opening | Attachment-style file cards and protected new-window POST opening without iframe/blob | PR #48 merged as `f8f3e40` and Render deployed it live. Production verification confirmed the merged-PDF file card, open-file button, new-window POST flow, and absence of iframe/blob delivery. |
| AM-IMP-2026.0830.05 | Deployed | LINE external-browser contract review links | External-browser opening for new LINE invitations plus a legacy-link fallback | PR #50 merged as `baafe84` and Render deployed it live. Production returned the fallback and protected external-browser link logic with `no-store`; final Android/iOS handoff should be confirmed from a newly issued LINE message. |
| AM-IMP-2026.0830.06 | Deployed | Contract review page script hotfix | Browser-safe LINE detection and executable generated-script regression coverage | PR #52 merged as `119ffe9` and Render deployed it live. The actual HZ-CT-001 V2 review displayed the merged PDF, three original attachments, and feedback form with no browser error; the shared V1/V2 runtime is restored without changing stored data. |

## Tenant and evidence boundaries

- Engineering AM's graphical `/contracts?tenant=engineering` workspace is the
  primary internal management interface.
- PostgreSQL schema `engineering_contracts` is the authoritative workflow and
  signing-evidence store. Notion is a retryable management projection only.
- Contract files and generated evidence must remain below the existing
  Engineering Drive root. No Rental, HOZO, Seven, Forest, or Green Hotel data
  may be copied into this workflow.
- Invitations are sent to the contract project's active LINE group. Possession
  of the group-visible link is not signing authority; the designated LINE user,
  current group membership, LIFF identity, token, and frozen bundle hash must
  all match.

## Activation gate

`ENG_CONTRACTS_SIGNING_ENABLED` stays `0` until every remaining check in the
project-local upgrade record and package `VERIFY.md` passes. A deployed runtime
with signing disabled is not a completed signing deployment and must not be
recorded as `Deployed`.
