# AM-IMP-2026.0913.02 — Claims form administrator previews

Status: `Deployed`

The protected HOZO claims console now opens administrator previews for all four catalogued
forms. The three legacy entries reuse the production LIFF renderer with their claim type fixed.
The V3 entry opens the production applicant page in an inert preview mode with generic scope
data. Neither preview path creates a LINE identity session, claim draft, attachment, or claim.

## Production evidence

- Rental PR #265 merged as `70e5bb7`; Cloudflare Pages deployment run `34739213603` passed.
- AMCore PR #146 merged as `19c7206`; Render deployment `dep-daj2s6ojo6nc73c1u04g` is Live.
- The production catalog displayed four 「開啟管理者預覽」 links.
- The production legacy-other preview fixed the type to 「其他費用」 and disabled attachment
  and submit controls.
- The production V3 preview rendered the complete applicant form and disabled attachment,
  draft-save, and final-submit controls.

No production claim, attachment, identity, group binding, or finance record was mutated during
verification.
