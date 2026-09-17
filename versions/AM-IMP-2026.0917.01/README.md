# Contract version amount authority

Use the saved document package's `contractFields.contractAmount` for payment validation at draft creation, freeze, and issue readiness. A later master/Notion price edit cannot change an approved or frozen version's agreed amount. Packages predating this field retain the master fallback; explicitly invalid snapshot amounts fail validation rather than silently falling back.

The workspace displays server-computed validation, version total, payment total, and exact localized mismatches instead of claiming completeness based only on field presence. Percentage-only payment schedules use the issued version's total too; no bank operation is introduced.

Target: AM Platform Engineering only. No migration, backfill, contract edits, freeze, signing action or LINE send is performed during rollout.
