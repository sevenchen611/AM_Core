# Standalone LINE staff ledger intake

Owner: this Codex session. Depends on Rental's narrowly scoped integration options/intake endpoint and atomic reviewed cash posting. Merge Rental before AM.

Replace the mobile card's admin URL with a LINE selector session form. Reuse the existing mobile registration layout with both income and expense. Each options/submission request must revalidate the published internal form, current group/member authority and original LINE sender. No admin login, admin API proxy or Finance Claims V3 identity bridge.

The form sends entries to Maggie (陸昱晴); up to TWD 30,000 posts after her approval, above that waits for Seven. Preserve source group, verified applicant and idempotency. Keep the existing internal group assignment and vendor forms.

Upgrade package: AM-IMP-2026.1004.04. No PostgreSQL schema change is expected. Runtime verification uses synthetic data and no LINE messages or production financial entries.
