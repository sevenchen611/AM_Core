# Install

Apply the renderer and regression tests to the root platform. Run the required
checks, review the change, and deploy the commit merged to GitHub main. Confirm
the live health commit before consumers send `appearance`.

Consumers can then opt individual active review actions into `primary` or
`secondary`. No schema migration, new secret or permission grant is needed.
Install into standalone projects separately only when requested, preserving their
project-owned credentials, event state and data.
