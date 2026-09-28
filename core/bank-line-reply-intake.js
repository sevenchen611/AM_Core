import crypto from 'node:crypto';

const JOB_KIND = 'bank-line-reply';
// Only notification-registry-owned quotes enter this tenant's durable inbox.
export function createBankLineReplyIntake({ tenant, memory, router, pushKey, rentalBase, fetchImpl = fetch, logger = console }) {
  let draining = false;
  async function receive(event) {
    const groupId = event?.source?.groupId || event?.source?.roomId || '';
    if (!tenant || !groupId || event?.type !== 'message' || event.message?.type !== 'text' || !event.message.quotedMessageId) return false;
    const ownership = await memory.bankFinanceQuoteOwnership(tenant, event.message.quotedMessageId, groupId, event.source?.userId || '');
    if (!ownership.known) return false;
    if (!ownership.groupVerified) {
      const resolved = await router.resolveGroupBinding(groupId);
      if (resolved.resolution === 'lookup_failed' || resolved.reason === 'lookup_failed') throw new Error('bank_reply_group_lookup_failed');
      if (resolved.tenant?.key !== tenant.key) return false;
    }
    const payload = {
      eventId: event.webhookEventId || event.message.id,
      messageId: event.message.id,
      quotedMessageId: event.message.quotedMessageId,
      groupId, userId: event.source?.userId || '', text: event.message.text,
      timestamp: event.timestamp || null,
    };
    if (!payload.eventId || !payload.messageId || !payload.userId || typeof payload.text !== 'string') throw new Error('bank_reply_invalid_event');
    const payloadDigest = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const saved = await memory.enqueueProcessingJob(tenant, {
      jobKind: JOB_KIND, idempotencyKey: `line:${payload.messageId}`, maxAttempts: 20,
      inputPayload: { contract: 'bank-line-reply-v1', payload, payloadDigest, receivedAt: new Date().toISOString() },
    });
    if (!saved.ok || saved.job?.input_payload?.payloadDigest !== payloadDigest) throw new Error('bank_reply_persistence_or_identity_failed');
    return { handled: true, replayed: saved.job.replayed };
  }
  async function drain() {
    if (draining || !tenant || !pushKey) return;
    draining = true;
    try {
      // Unique lease token fences late responses from an expired worker.
      const leaseOwner = `bank-reply:${crypto.randomUUID()}`;
      const jobs = await memory.leaseProcessingJobs(tenant, { jobKind: JOB_KIND, limit: 5, leaseSeconds: 120, leaseOwner });
      for (const job of jobs) {
        const settlement = { jobId: job.job_id, leaseOwner };
        try {
          const response = await fetchImpl(`${rentalBase.replace(/\/+$/, '')}/api/integrations/finance/bank-line-reply`, {
            method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${pushKey}` },
            body: JSON.stringify(job.input_payload.payload), signal: AbortSignal.timeout(15000),
          });
          if (!response.ok) throw new Error(`bank_reply_http_${response.status}`);
          const result = await response.json();
          // Old receiver versions and incomplete processing must never count as receipt.
          if (result.saved !== true || result.handled !== true) throw new Error('bank_reply_receipt_unconfirmed');
          await memory.settleProcessingJob(tenant, { ...settlement, status: 'succeeded', outputPayload: result });
        } catch (error) {
          const code = /^bank_reply_[a-z0-9_]+$/.test(error.message) ? error.message : 'bank_reply_transport_failed';
          const dead = job.attempt_count >= job.max_attempts;
          await memory.settleProcessingJob(tenant, {
            ...settlement, status: dead ? 'dead_letter' : 'retry',
            retryDelaySeconds: Math.min(3600, 15 * 2 ** Math.min(job.attempt_count - 1, 8)), errorPayload: { code },
          });
          logger.warn(`[bank-line-reply] ${dead ? 'manual_review' : 'retry'} (${code})`);
        }
      }
    } finally { draining = false; }
  }
  return { receive, drain };
}
