# Faster fresh authorization for personal LINE commands

Status: Ready. Personal-group identity, exclusive member count and owner
membership are checked with three parallel LINE requests. Concurrent read-only
requests for the same group and user share an unfinished proof; the proof is
removed immediately on success or failure. There is no completed-result cache.

New event capture, Reply, Push, binding confirmation and resume each start fresh
checks. Membership events invalidate pending checks, and every verification reads
the current database binding status so revocation cannot rely on an old snapshot.
The fresh personal Push proof also replaces its redundant second owner lookup.

Groups and event polling authorize up to four groups concurrently while preserving
configured group order. An unavailable group still fails an event page before the
cursor can advance. This reduces serialized provider waits; the final response
time still depends on LINE, database and UOF processing.
