# AM-IMP-2026.0921.02 — External claims authority-only legacy routing

External vendor groups now use the existing claims authority registry throughout
legacy form selection and submission. They no longer require a duplicate Notion
group binding after the registry has verified the active group, present OA,
observed applicant, individual deny state and currently published form.

Internal and non-authority legacy claims keep their existing live Notion checks.
This package changes no schema, environment variable, Rental contract, Finance V3
membership or financial data.
