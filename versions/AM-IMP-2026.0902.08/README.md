# AM-IMP-2026.0902.08 - Party A profile master

Engineering contract managers can maintain reusable Party A profiles instead of
typing the same contracting-party information into every contract version.

- A company profile contains its legal name, tax id, responsible person,
  representative, address, company seal, and responsible-person seal.
- An individual profile contains the person's name, representative, optional
  identity number, address, and signature.
- Seal and signature images stay in the existing private Engineering contract
  Drive boundary. PostgreSQL stores only private file references and SHA-256
  hashes.
- Selecting a profile in the contract-version editor copies the profile and its
  signing assets into that version's immutable snapshot. Later profile edits do
  not rewrite old contracts.
- The final signed PDF applies the selected company's two seals or the selected
  individual's signature only after Party B signs and Party A confirms.

No real company, individual, seal, signature, token, or production database id
is included in this package.
