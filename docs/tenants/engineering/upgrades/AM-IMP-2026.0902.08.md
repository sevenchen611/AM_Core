# Engineering installation — AM-IMP-2026.0902.08

Status: Installed

The Engineering AM runtime now contains the Party A profile master, private
signing-asset upload path, contract-version snapshot integration, and final PDF
rendering support. Local dry-runs cover company and individual validation,
private Drive/hash verification, schema v6, and PDF output.

Production remains unchanged. Before marking this package Deployed:

- apply the v6 migration with the restricted Engineering runtime role;
- deploy and verify the authenticated `甲方主檔` page;
- import the real company and personal records from the project owner's source
  folder without copying them into AMCore;
- create a controlled test version and verify its immutable snapshot;
- verify the final signed PDF with the selected company's two seals or the
  selected individual's signature.
