# AM-IMP-2026.0901.07 - Contractor details and Word-like PDF tables

This package makes contractor name, identity number, and address mandatory at the formal signature boundary and places the verified values in the final signed contract PDF.

It also preserves structural tables from uploaded Word contract bodies and replaces the generated party, payment, acceptance, and attachment lists with bordered A4 tables. The party table has explicit 甲方 and 乙方 columns, while payment rows keep payment stage, amount, date, time, and condition aligned.

The raw contractor details remain excluded from LINE messages and public responses. PostgreSQL's existing immutable JSON evidence stores the exact values; the evidence receipt stores their canonical SHA-256.
