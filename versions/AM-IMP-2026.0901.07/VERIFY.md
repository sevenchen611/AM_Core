# Verify

1. The signing page shows required fields for 乙方姓名, 身分證字號, and 住址.
2. Missing or malformed values fail before signature or evidence persistence.
3. Submitted values enter the immutable signing snapshot and do not enter LINE status messages or public API responses.
4. Completion rejects signing evidence without all three values.
5. The final signed PDF shows the values in the 乙方 column of a clearly labelled 甲方/乙方 table.
6. Word tables remain bordered tables in the generated PDF.
7. Payment stage, amount, date, time, and condition appear in aligned columns.
8. Table headings are not stranded at the bottom of a page and content does not overlap the footer.
9. The evidence receipt stores only the canonical contractor-details SHA-256, not duplicated raw identity data.
10. All targeted dry-runs, package validation, PDF text extraction, and page-image inspection pass.
