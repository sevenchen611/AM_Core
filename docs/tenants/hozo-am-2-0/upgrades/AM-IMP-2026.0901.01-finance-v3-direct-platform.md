# Finance Claims v3 direct AM Platform owner

`am-platform` now owns the Finance Claims v3 LINE command intake, durable workflow and notification receiver in one paid Render service.

For exact `請款` and `費用申請` messages, the LINE webhook resolves the HOZO binding and persists an idempotent PostgreSQL record before returning HTTP 200. A persistence outage returns HTTP 503 so LINE can redeliver the same webhook event safely. The local drainer then performs membership verification, Rental web-entry creation and LINE delivery with durable leases and reconciliation.

The former AM operational-memory job that waited for a separate HOZO-AM gateway is no longer created by the new runtime. Before cutover, every already-accepted pending/retry job must either finish under the old sole owner or be replayed into the canonical ingress and explicitly settled; completed historical rows remain untouched for audit. Rental keeps its own notification outbox, while AM keeps the provider-delivery ledger and retry/reconciliation state.

Production uses the existing Finance Claims v3 PostgreSQL database during cutover so idempotency history remains continuous. Raw LINE targets never enter AM durable ledgers: they remain in secret Render bindings and are used only transiently in the TLS-protected Rental bridge or LINE provider request. Durable workflow records contain opaque `line-ref:v1` references.

Verification command:

```text
npm run dryrun:finance-v3-direct
```
