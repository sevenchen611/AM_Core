export function createClaimsAuthorityOutboxWorker({ store, dispatcher, workerId, maxAttempts = 8 } = {}) {
  if (!store?.leaseOutbox || !store?.completeOutbox || !store?.failOutbox) {
    throw new Error('Claims authority outbox store is incomplete.');
  }
  if (typeof dispatcher?.dispatch !== 'function') throw new Error('Claims authority outbox dispatcher is required.');
  if (!String(workerId || '')) throw new Error('Claims authority outbox worker id is required.');

  return {
    async runOnce({ limit = 25, leaseSeconds = 60 } = {}) {
      const leased = await store.leaseOutbox({ workerId, limit, leaseSeconds });
      const results = [];
      for (const item of leased) {
        try {
          await dispatcher.dispatch({
            tenantId: item.tenant_id,
            eventKey: item.event_key,
            type: item.event_type,
            groupLookup: item.group_lookup,
            payload: item.payload,
          });
          await store.completeOutbox({ workerId, tenantId: item.tenant_id, eventKey: item.event_key });
          results.push({ eventKey: item.event_key, status: 'sent' });
        } catch (error) {
          const failed = await store.failOutbox({
            workerId,
            tenantId: item.tenant_id,
            eventKey: item.event_key,
            error,
            maxAttempts,
          });
          results.push({ eventKey: item.event_key, status: failed.status });
        }
      }
      return { leased: leased.length, results };
    },
  };
}
