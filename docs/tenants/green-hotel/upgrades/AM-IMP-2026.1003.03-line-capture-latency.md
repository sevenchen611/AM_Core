# Personal LINE capture database latency

Status: Ready pending review and main deployment.

The first latency change reduced gateway event polling from about 1.1 seconds to
0.3–0.4 seconds. Subsequent real commands still took approximately 2–3 seconds from
LINE input to accepted reply, so this change reduces the remaining serialized
database work during event capture and authorization.

Binding lifecycle updates and directory observation must both finish before event
append. Each authorization still reads durable binding status before and after
fresh LINE identity requests. Expiry is handled atomically with each current-row
read; no durable data or credentials are copied between tenants.

Synthetic verification must complete before merge. Production latency requires new
real operation samples after the deployed health commit is confirmed.
