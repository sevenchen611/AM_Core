# AM-IMP-2026.0902.06 - Personal Party A signing readiness

Status: Installed

## Engineering installation

- Party A's company registration number is optional when the principal is an
  individual.
- Formal readiness continues to require the principal name, responsible person,
  representative or signer, identity number, address, and all other frozen
  contract evidence.
- The runtime now recognizes the installed PostgreSQL contract evidence schema
  v5 while retaining compatibility with v4.
- The graphical workspace explains that the registration number is only needed
  for a company.

## Operational boundary

The package does not enable or send a formal LINE signing invitation.
`ENG_CONTRACTS_SIGNING_ENABLED` remains a separate production control and must
be enabled only after explicit operator confirmation.

## Verification

Local syntax and contract dry-runs pass. Production deployment, authenticated
readiness verification, and any separately authorized activation are recorded
after deployment.
