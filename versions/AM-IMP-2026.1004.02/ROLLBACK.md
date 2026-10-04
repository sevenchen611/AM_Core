# Rollback

First stop consumer applications from serializing `appearance`, then revert the
gateway change through a reviewed main commit. Reversing this order would cause
older gateways to reject new card payloads. Preserve event cursors, reply claims,
binding state, scoped credentials and approval journals. No database rollback is
required.
