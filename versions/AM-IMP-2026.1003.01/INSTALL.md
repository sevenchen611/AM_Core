# Install

Review and merge the gateway change to GitHub main, then deploy that reviewed
main revision to AM Platform. Keep the existing LINE channel, scoped transport
and management keys, bindings, database and feature flags. No migration or new
configuration is required. Apply any matching UOF application polling changes
separately in its repository and record its verified version there.

This package targets the shared AM Platform transport. It does not install a
separate service or copy live data into HOZO_AM or SevenAM.
