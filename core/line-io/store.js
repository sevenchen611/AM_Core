import crypto from 'node:crypto';

export const ioError = (status, code) => Object.assign(new Error(code), { status, code });

// Deployment-owned PostgreSQL only. No production messages or keys go into AMCore files.
export function createLineIoStore(pool) {
  async function transaction(work) {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const result = await work(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { db.release(); }
  }

  async function append(records) {
    if (!records.length) return;
    await transaction(async (db) => {
      // Allocate sequence IDs in commit order: concurrent webhooks cannot commit
      // a smaller cursor after a reader has already consumed a larger one.
      await db.query('SELECT pg_advisory_xact_lock(9282026, 1)');
      for (const record of records) {
        const { tenantKey, groupId, event } = record;
        if (event.type === 'unsend' && event.unsend?.messageId) {
          // Keep an unsend tombstone even if LINE redelivers the original later.
          await db.query(`INSERT INTO line_io.line_io_unsent (tenant_key, group_id, message_id)
            VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [tenantKey, groupId, event.unsend.messageId]);
          await db.query(`UPDATE line_io.line_io_events SET payload = jsonb_set(payload, '{event,message}',
            jsonb_build_object('id', $3::text, 'unsent', true))
            WHERE tenant_key = $1 AND group_id = $2 AND payload #>> '{event,message,id}' = $3`,
          [tenantKey, groupId, event.unsend.messageId]);
        }
        let payload = record;
        if (event.message?.id) {
          const removed = await db.query(`SELECT 1 FROM line_io.line_io_unsent
            WHERE tenant_key = $1 AND group_id = $2 AND message_id = $3`, [tenantKey, groupId, event.message.id]);
          if (removed.rowCount) payload = { ...record, event: { ...event, message: { id: event.message.id, unsent: true } } };
        }
        await db.query(`INSERT INTO line_io.line_io_events (tenant_key, group_id, event_id, payload)
          VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (tenant_key, event_id) DO NOTHING`,
        [tenantKey, groupId, event.webhookEventId, JSON.stringify(payload)]);
      }
    });
  }

  async function list({ tenantKey, groupIds, inputUserIds, personalBindings=[], after, limit }) {
    const result = await pool.query(`SELECT seq::text AS cursor, received_at, payload
      FROM line_io.line_io_events WHERE tenant_key = $1 AND group_id = ANY($2::text[]) AND seq > $3::bigint
      AND (CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements($6::jsonb) AS b WHERE b->>'groupId'=group_id)
        THEN EXISTS(SELECT 1 FROM jsonb_array_elements($6::jsonb) AS b WHERE b->>'groupId'=group_id AND b->>'bindingId'=payload->>'bindingId'
          AND (payload #>> '{event,type}' NOT IN ('message','postback') OR b->>'userId'=payload #>> '{event,source,userId}'))
        ELSE ($5::text[] IS NULL OR payload #>> '{event,type}' NOT IN ('message', 'postback') OR payload #>> '{event,source,userId}' = ANY($5::text[])) END)
      ORDER BY seq LIMIT $4`, [tenantKey, groupIds, after, limit + 1, inputUserIds || null,JSON.stringify(personalBindings)]);
    const events = result.rows.slice(0, limit).map((row) => ({
      ...row.payload, cursor: row.cursor, receivedAt: row.received_at,
    }));
    return { events, nextCursor: events.at(-1)?.cursor || after, hasMore: result.rows.length > limit };
  }

  // Reserve before sending; persist the same LINE retry UUID across restarts and
  // concurrent callers. A short lease prevents simultaneous pushes of one report.
  async function reserve({ tenantKey, clientId, key, hash }) {
    return transaction(async (db) => {
      const args = [tenantKey, clientId, key];
      await db.query(`INSERT INTO line_io.line_io_sends (tenant_key, client_id, idempotency_key, body_hash, retry_key)
        VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`, [...args, hash, crypto.randomUUID()]);
      const { rows: [row] } = await db.query(`SELECT *,
        created_at < now() - interval '23 hours' AS expired,
        lease_until > now() AS busy FROM line_io.line_io_sends
        WHERE tenant_key = $1 AND client_id = $2 AND idempotency_key = $3 FOR UPDATE`, args);
      if (row.body_hash !== hash) throw ioError(409, 'idempotency_conflict');
      if (row.result) return { result: row.result };
      if (row.expired) throw ioError(409, 'retry_window_expired');
      if (row.busy) throw ioError(409, 'send_in_progress');
      const attempt = crypto.randomUUID();
      await db.query(`UPDATE line_io.line_io_sends SET lease_until = now() + interval '30 seconds', attempt = $4
        WHERE tenant_key = $1 AND client_id = $2 AND idempotency_key = $3`, [...args, attempt]);
      return { retryKey: row.retry_key, attempt };
    });
  }

  async function finish({ tenantKey, clientId, key, attempt, result }) {
    await pool.query(`UPDATE line_io.line_io_sends SET result = $5::jsonb, lease_until = NULL
      WHERE tenant_key = $1 AND client_id = $2 AND idempotency_key = $3 AND attempt = $4`,
    [tenantKey, clientId, key, attempt, result ? JSON.stringify(result) : null]);
  }

  return { append, list, reserve, finish };
}
