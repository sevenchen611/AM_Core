# AM-IMP-2026.1006.04 — Compact Rich Menu

Status: Deployed. Target LINE application verified on 2026-10-06.

Applied from reviewed PR #243 / main `1ef1f0cee6418f7cb009298b8c1789658441b66b`. The channel identity and active default were confirmed. LINE returned exactly the right-half message action 待簽 and no journal click area. The image retrieved from LINE matched the local PNG SHA-256. The production receipt is outside AMCore. No chat message or UOF approval request was sent during installation.

The account menu becomes a single row with two visual tiles. 工作日誌 is marked 暫未開放 with no link or click area. UOF 簽核 sends 待簽 through the existing independent UOF route. AM private assistant enablement is unchanged.

SVG/PNG visual inspection, exact click bounds, script syntax and package completeness checks passed. The application script validates the actual target account and LINE object, uploads before switching the default and verifies exact actions. Production receipts remain outside AMCore; old Manager/default menus are retained for rollback. No LINE chat messages are sent by this installation.
