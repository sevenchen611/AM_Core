# Rollback

Revert the AM release and the coordinated Rental release together. Claims made
before this package continue using the previous accounting-source fallback;
new opaque origin references must not be emitted while an older AM receiver is
active.
