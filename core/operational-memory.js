// AM Platform core — PostgreSQL operational memory adapter.
//
// This adapter is deliberately fail-open at the platform boundary: shadow-memory
// failures are observable, but they never block the existing LINE/Notion path.
// Inside PostgreSQL every operation is fail-closed through a transaction-local
// app.tenant_id, forced RLS, evidence links, and idempotency keys.

import crypto from 'node:crypto';

const MODES = new Set(['off', 'shadow', 'enforce']);
const QUERY_MODES = new Set(['legacy', 'shadow', 'structured-first']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_TYPES = new Set([
  'task_requested', 'decision_made', 'request_raised', 'issue_raised',
  'progress_reported', 'commitment_made', 'meeting_scheduled', 'risk_raised',
  'information_observed', 'question_raised', 'completion_reported',
  'cancellation_reported', 'change_reported', 'manual_correction', 'approval',
]);
const TASK_EVENT_TYPES = new Set([
  'task_requested', 'request_raised', 'issue_raised', 'commitment_made', 'question_raised',
]);

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const normalize = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
const safeText = (value, max = 8000) => String(value || '').slice(0, max);
const positiveInt = (value, fallback, ceiling = 100) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? Math.min(number, ceiling) : fallback;
};

function tenantConfig(tenant, env) {
  const declared = tenant?.operationalMemory || {};
  const prefix = String(tenant?.envPrefix || '').toUpperCase();
  const fromEnv = (name, fallback = '') => env[`${prefix}_${name}`] || env[name] || fallback;
  const declaredMode = declared.enabled === false ? 'off' : (declared.activationMode || 'off');
  const mode = String(fromEnv('AM_MEMORY_MODE', declaredMode)).toLowerCase();
  const queryMode = String(fromEnv('AM_MEMORY_QUERY_MODE', declared.queryMode || 'legacy')).toLowerCase();
  const databaseUrl = fromEnv('AM_MEMORY_DATABASE_URL', '');
  return {
    tenantId: String(tenant?.tenantId || declared.tenantId || ''),
    tenantKey: String(tenant?.key || ''),
    displayName: String(tenant?.displayName || tenant?.key || ''),
    mode: MODES.has(mode) ? mode : 'off',
    queryMode: QUERY_MODES.has(queryMode) ? queryMode : 'legacy',
    databaseUrl,
    configured: Boolean(UUID_RE.test(String(tenant?.tenantId || declared.tenantId || '')) && databaseUrl),
    batchSize: positiveInt(fromEnv('AM_MEMORY_WORKER_BATCH_SIZE', declared.workerBatchSize), 8, 25),
    knowledgePromotion: String(fromEnv('AM_MEMORY_KNOWLEDGE_PROMOTION', declared.knowledgePromotion || 'review-only')),
    notionProjection: fromEnv('AM_MEMORY_NOTION_PROJECTION', declared.notionProjection ? '1' : '0') === '1',
    vectorSearch: fromEnv('AM_MEMORY_VECTOR_SEARCH', declared.vectorSearch ? '1' : '0') === '1',
  };
}

function sanitizedEnvelope(ctx) {
  const event = ctx?.event || {};
  const message = ctx?.message || {};
  return {
    type: event.type || 'message',
    timestamp: event.timestamp || null,
    source: {
      type: event.source?.type || null,
      groupId: event.source?.groupId || null,
      roomId: event.source?.roomId || null,
      userId: event.source?.userId || null,
    },
    message: {
      id: message.id || null,
      type: message.type || null,
      text: message.type === 'text' ? safeText(message.text, 20000) : null,
      fileName: safeText(message.fileName, 500) || null,
      fileSize: Number(message.fileSize) || null,
      quoteTokenPresent: Boolean(message.quoteToken),
    },
    binding: {
      role: ctx?.binding?.role || null,
      projectPagePresent: Boolean(ctx?.binding?.projectPageId),
      bindingPagePresent: Boolean(ctx?.binding?.pageId),
    },
  };
}

function occurredAt(ctx) {
  const parsed = Number(ctx?.event?.timestamp);
  return new Date(Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now()).toISOString();
}

function retryDelay(attempt) {
  const seconds = Math.min(3600, Math.max(30, 30 * (2 ** Math.max(0, attempt - 1))));
  return `${seconds} seconds`;
}

export function createOperationalMemory({ env = process.env, logger = console, poolFactory = null } = {}) {
  const pools = new Map();

  async function poolFor(config) {
    if (!config.databaseUrl) return null;
    if (pools.has(config.databaseUrl)) return pools.get(config.databaseUrl);
    let factory = poolFactory;
    if (!factory) {
      const pg = await import('pg');
      factory = (options) => new pg.Pool(options);
    }
    const pool = factory({
      connectionString: config.databaseUrl,
      max: positiveInt(env.AM_MEMORY_POOL_SIZE, 4, 20),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      application_name: 'am-platform-operational-memory',
    });
    pools.set(config.databaseUrl, pool);
    return pool;
  }

  async function withTenant(tenant, work) {
    const config = tenantConfig(tenant, env);
    if (!config.configured || config.mode === 'off') {
      const reason = config.mode === 'off' ? 'off' : 'database-not-configured';
      return { skipped: reason, config };
    }
    const pool = await poolFor(config);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [config.tenantId]);
      const value = await work(client, config);
      await client.query('COMMIT');
      return { value, config };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function ensureTenant(client, config) {
    await client.query(
      `INSERT INTO am_memory.tenants (tenant_id, tenant_key, display_name, settings)
       VALUES ($1, $2, $3, jsonb_build_object('packageId', 'AM-IMP-2026.0718.01'))
       ON CONFLICT (tenant_id) DO UPDATE
         SET tenant_key = EXCLUDED.tenant_key,
             display_name = EXCLUDED.display_name,
             settings = am_memory.tenants.settings || EXCLUDED.settings`,
      [config.tenantId, config.tenantKey, config.displayName],
    );
  }

  async function ingestLineMessage(ctx) {
    const tenant = ctx?.tenant;
    const settings = tenantConfig(tenant, env);
    if (settings.mode === 'off') return { ok: true, skipped: 'off' };
    if (!settings.configured) return { ok: true, skipped: 'database-not-configured' };

    try {
      const result = await withTenant(tenant, async (client, config) => {
        await ensureTenant(client, config);
        const message = ctx.message || {};
        const event = ctx.event || {};
        const messageId = safeText(message.id, 500);
        if (!messageId) throw new Error('LINE message id is required for operational-memory ingestion');
        const groupExternalKey = safeText(
          event.source?.groupId || event.source?.roomId || `direct:${event.source?.userId || 'unknown'}`,
          500,
        );
        const senderExternalKey = safeText(event.source?.userId || `display:${ctx.senderName || 'unknown'}`, 500);
        const groupName = safeText(ctx.binding?.groupName || ctx.binding?.name || groupExternalKey, 500);
        const senderName = safeText(ctx.senderName || '未知成員', 500);
        const sourceKey = `line:${messageId}`;
        const idempotencyKey = sha256(`${config.tenantId}|${sourceKey}`);
        const content = message.type === 'text'
          ? safeText(message.text, 20000)
          : safeText(ctx.operationalMemoryText, 20000);

        const groupResult = await client.query(
          `INSERT INTO am_memory.conversation_groups
             (tenant_id, source_system, external_group_key, group_name, group_type, attributes)
           VALUES ($1, 'line', $2, $3, $4, $5::jsonb)
           ON CONFLICT (tenant_id, source_system, external_group_key) DO UPDATE
             SET group_name = EXCLUDED.group_name,
                 group_type = EXCLUDED.group_type,
                 attributes = am_memory.conversation_groups.attributes || EXCLUDED.attributes
           RETURNING group_id`,
          [config.tenantId, groupExternalKey, groupName,
            event.source?.groupId ? 'group' : event.source?.roomId ? 'room' : 'direct',
            JSON.stringify({ bindingRole: ctx.binding?.role || null })],
        );
        const groupId = groupResult.rows[0].group_id;

        const personResult = await client.query(
          `INSERT INTO am_memory.people
             (tenant_id, source_system, external_person_key, display_name, attributes)
           VALUES ($1, 'line', $2, $3, '{}'::jsonb)
           ON CONFLICT (tenant_id, source_system, external_person_key) DO UPDATE
             SET display_name = EXCLUDED.display_name
           RETURNING person_id`,
          [config.tenantId, senderExternalKey, senderName],
        );
        const personId = personResult.rows[0].person_id;

        const sourceInsert = await client.query(
          `INSERT INTO am_memory.source_records
             (tenant_id, source_kind, source_system, external_source_key, idempotency_key,
              group_id, author_person_id, occurred_at, source_locator, content_text,
              content_sha256, immutable_payload)
           VALUES ($1, 'line_message', 'line', $2, $3, $4, $5, $6,
             $7::jsonb, $8, $9, $10::jsonb)
           ON CONFLICT (tenant_id, source_system, external_source_key) DO NOTHING
           RETURNING source_id`,
          [config.tenantId, sourceKey, idempotencyKey, groupId, personId, occurredAt(ctx),
            JSON.stringify({ groupExternalKey, messageId }), content || null,
            content ? sha256(content) : null, JSON.stringify(sanitizedEnvelope(ctx))],
        );
        let sourceId = sourceInsert.rows[0]?.source_id;
        const deduplicated = !sourceId;
        if (!sourceId) {
          const existing = await client.query(
            `SELECT source_id FROM am_memory.source_records
              WHERE tenant_id = $1 AND source_system = 'line' AND external_source_key = $2`,
            [config.tenantId, sourceKey],
          );
          sourceId = existing.rows[0]?.source_id;
        }
        if (!sourceId) throw new Error('Unable to resolve idempotent source record');

        await client.query(
          `INSERT INTO am_memory.raw_messages
             (tenant_id, source_id, source_system, external_message_id, group_id,
              sender_person_id, message_type, original_content, extracted_text,
              occurred_at, ingestion_status, raw_envelope)
           VALUES ($1, $2, 'line', $3, $4, $5, $6, $7, $7, $8, 'queued', $9::jsonb)
           ON CONFLICT (tenant_id, source_system, external_message_id) DO NOTHING`,
          [config.tenantId, sourceId, messageId, groupId, personId,
            safeText(message.type || 'unknown', 100), content || null, occurredAt(ctx),
            JSON.stringify(sanitizedEnvelope(ctx))],
        );

        await client.query(
          `INSERT INTO am_memory.processing_jobs
             (tenant_id, job_kind, idempotency_key, source_id, input_payload)
           VALUES ($1, 'extract_operational_events', $2, $3,
             jsonb_build_object('sourceId', $3::text, 'groupExternalKey', $4::text))
           ON CONFLICT (tenant_id, job_kind, idempotency_key) DO NOTHING`,
          [config.tenantId, idempotencyKey, sourceId, groupExternalKey],
        );
        return { sourceId, deduplicated };
      });
      return { ok: true, ...result.value };
    } catch (error) {
      logger.warn(`[operational-memory] shadow ingest failed (tenant=${tenant?.key || '?'}): ${error.message}`);
      return { ok: false, error: error.message };
    }
  }

  async function leaseJobs(tenant, limit) {
    const result = await withTenant(tenant, async (client, config) => {
      await ensureTenant(client, config);
      const leased = await client.query(
        `WITH ready AS (
           SELECT job_id
             FROM am_memory.processing_jobs
            WHERE tenant_id = $1
              AND job_kind = 'extract_operational_events'
              AND status IN ('queued', 'retry')
              AND available_at <= clock_timestamp()
            ORDER BY available_at, created_at
            FOR UPDATE SKIP LOCKED
            LIMIT $2
         )
         UPDATE am_memory.processing_jobs AS jobs
            SET status = 'leased',
                attempt_count = jobs.attempt_count + 1,
                lease_owner = $3,
                lease_expires_at = clock_timestamp() + interval '5 minutes'
           FROM ready
          WHERE jobs.tenant_id = $1 AND jobs.job_id = ready.job_id
         RETURNING jobs.job_id, jobs.source_id, jobs.attempt_count, jobs.trace_id`,
        [config.tenantId, positiveInt(limit, config.batchSize, 25), `am-platform:${process.pid}`],
      );
      const jobs = [];
      for (const job of leased.rows) {
        const source = await client.query(
          `SELECT s.source_id, s.source_kind, s.content_text, s.occurred_at,
                  s.source_locator, s.immutable_payload,
                  g.external_group_key, g.group_name
             FROM am_memory.source_records s
             LEFT JOIN am_memory.conversation_groups g
               ON g.tenant_id = s.tenant_id AND g.group_id = s.group_id
            WHERE s.tenant_id = $1 AND s.source_id = $2`,
          [config.tenantId, job.source_id],
        );
        if (source.rows[0]) jobs.push({ ...job, source: source.rows[0] });
      }
      return jobs;
    });
    return result.skipped ? [] : result.value;
  }

  async function loadStructuredContext(tenant, source, limit = 20) {
    const result = await withTenant(tenant, async (client, config) => {
      const groupKey = source?.external_group_key || '';
      const messages = await client.query(
        `SELECT s.source_id, s.occurred_at, s.content_text, p.display_name
           FROM am_memory.source_records s
           LEFT JOIN am_memory.conversation_groups g
             ON g.tenant_id = s.tenant_id AND g.group_id = s.group_id
           LEFT JOIN am_memory.people p
             ON p.tenant_id = s.tenant_id AND p.person_id = s.author_person_id
          WHERE s.tenant_id = $1
            AND ($2 = '' OR g.external_group_key = $2)
            AND s.content_text IS NOT NULL
          ORDER BY s.occurred_at DESC
          LIMIT $3`,
        [config.tenantId, groupKey, positiveInt(limit, 20, 50)],
      );
      const tasks = await client.query(
        `SELECT task_key, title, status, confirmation_status, next_action, blocker, waiting_for, due_at
           FROM am_memory.tasks
          WHERE tenant_id = $1 AND status NOT IN ('completed', 'cancelled', 'no_action')
          ORDER BY updated_at DESC LIMIT 30`,
        [config.tenantId],
      );
      const decisions = await client.query(
        `SELECT decision_id, title, statement, confirmation_status, lifecycle_status, updated_at
           FROM am_memory.decisions
          WHERE tenant_id = $1 AND lifecycle_status IN ('draft', 'active')
          ORDER BY updated_at DESC LIMIT 20`,
        [config.tenantId],
      );
      const projects = await client.query(
        `SELECT p.project_key, p.project_name, p.status,
                COALESCE(jsonb_agg(jsonb_build_object('goalKey', g.goal_key, 'title', g.title,
                  'status', g.status)) FILTER (WHERE g.goal_id IS NOT NULL), '[]'::jsonb) AS goals
           FROM am_memory.projects p
           LEFT JOIN am_memory.project_goals g
             ON g.tenant_id = p.tenant_id AND g.project_id = p.project_id
          WHERE p.tenant_id = $1
          GROUP BY p.tenant_id, p.project_id
          ORDER BY p.updated_at DESC LIMIT 20`,
        [config.tenantId],
      );
      return { messages: messages.rows.reverse(), tasks: tasks.rows, decisions: decisions.rows, projects: projects.rows };
    });
    return result.skipped ? { messages: [], tasks: [], decisions: [], projects: [] } : result.value;
  }

  async function storeExtraction(tenant, job, extraction, trace = {}) {
    const result = await withTenant(tenant, async (client, config) => {
      const sourceId = job.source_id;
      const traceResult = await client.query(
        `INSERT INTO am_memory.judgment_traces
           (tenant_id, source_id, job_id, analyzer_name, analyzer_version, prompt_version,
            rule_versions, model_name, run_key, output_payload, confidence)
         VALUES ($1, $2, $3, 'operational-event-extractor', '1.0.0', $4,
           $5::jsonb, $6, $7, $8::jsonb, $9)
         ON CONFLICT (tenant_id, analyzer_name, analyzer_version, run_key) DO UPDATE
           SET output_payload = EXCLUDED.output_payload,
               rule_versions = EXCLUDED.rule_versions,
               model_name = EXCLUDED.model_name,
               confidence = EXCLUDED.confidence
         RETURNING judgment_trace_id`,
        [config.tenantId, sourceId, job.job_id, trace.promptVersion || 'forest-shadow-v1',
          JSON.stringify(trace.rules || []), trace.model || null, String(job.job_id),
          JSON.stringify(extraction || {}), Number(extraction?.confidence) || null],
      );
      const judgmentTraceId = traceResult.rows[0].judgment_trace_id;
      const stored = [];
      for (const candidate of Array.isArray(extraction?.events) ? extraction.events.slice(0, 12) : []) {
        const eventType = EVENT_TYPES.has(candidate?.event_type) ? candidate.event_type : 'information_observed';
        const summary = safeText(candidate?.summary || candidate?.event_summary, 1000).trim();
        if (!summary) continue;
        const confidence = Math.max(0, Math.min(1, Number(candidate?.confidence) || 0.5));
        const eventKey = sha256(`${config.tenantId}|${sourceId}|${eventType}|${normalize(summary)}`);
        const eventInsert = await client.query(
          `INSERT INTO am_memory.events
             (tenant_id, idempotency_key, event_type, event_summary, topic_thread_key,
              subject_status, priority, event_time, due_at, confidence,
              confirmation_status, judgment_trace_id, rule_trace, attributes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, clock_timestamp()),
             $9::timestamptz, $10, 'candidate', $11, $12::jsonb, $13::jsonb)
           ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
           RETURNING event_id`,
          [config.tenantId, eventKey, eventType, summary,
            safeText(candidate.topic_thread_key, 500) || null,
            safeText(candidate.status, 100) || null,
            safeText(candidate.priority, 100) || null,
            candidate.event_time || job.source?.occurred_at || null,
            candidate.due_at || null, confidence, judgmentTraceId,
            JSON.stringify(trace.rules || []),
            JSON.stringify({
              shadow: config.mode === 'shadow',
              owner: candidate.owner || null,
              projectGuess: candidate.project_guess || null,
              goalGuess: candidate.goal_guess || null,
              existingTaskKey: candidate.existing_task_key || null,
              reason: candidate.reason || null,
              sensitive: Boolean(candidate.sensitive),
            })],
        );
        let eventId = eventInsert.rows[0]?.event_id;
        const newlyInserted = Boolean(eventId);
        if (!eventId) {
          const existing = await client.query(
            'SELECT event_id FROM am_memory.events WHERE tenant_id = $1 AND idempotency_key = $2',
            [config.tenantId, eventKey],
          );
          eventId = existing.rows[0]?.event_id;
        }
        if (!eventId) continue;
        await client.query(
          `INSERT INTO am_memory.event_sources
             (tenant_id, event_id, source_id, evidence_role, evidence_excerpt)
           VALUES ($1, $2, $3, 'basis', $4)
           ON CONFLICT DO NOTHING`,
          [config.tenantId, eventId, sourceId, safeText(job.source?.content_text, 1000) || null],
        );

        if (newlyInserted && TASK_EVENT_TYPES.has(eventType)) {
          const taskKey = `candidate:${eventKey.slice(0, 32)}`;
          const task = await client.query(
            `INSERT INTO am_memory.tasks
               (tenant_id, task_key, title, description, status, confirmation_status,
                formalization_status, priority, due_at, next_action, last_source_id, last_event_id)
             VALUES ($1, $2, $3, $4, 'candidate', 'candidate', 'candidate', $5,
               $6::timestamptz, $7, $8, $9)
             ON CONFLICT (tenant_id, task_key) DO NOTHING
             RETURNING task_id`,
            [config.tenantId, taskKey, summary,
              safeText(candidate.reason || 'Shadow candidate awaiting goal/evidence review.', 4000),
              safeText(candidate.priority, 100) || null, candidate.due_at || null,
              safeText(candidate.next_action, 1000) || null, sourceId, eventId],
          );
          const taskId = task.rows[0]?.task_id;
          if (taskId) {
            await client.query(
              `INSERT INTO am_memory.task_sources
                 (tenant_id, task_id, source_id, evidence_role, evidence_excerpt)
               VALUES ($1, $2, $3, 'basis', $4) ON CONFLICT DO NOTHING`,
              [config.tenantId, taskId, sourceId, safeText(job.source?.content_text, 1000) || null],
            );
            await client.query(
              `INSERT INTO am_memory.task_events (tenant_id, task_id, event_id, relation_type)
               VALUES ($1, $2, $3, 'created') ON CONFLICT DO NOTHING`,
              [config.tenantId, taskId, eventId],
            );
          }
        }

        if (newlyInserted && eventType === 'decision_made') {
          const decision = await client.query(
            `INSERT INTO am_memory.decisions
               (tenant_id, title, statement, background, confirmation_status,
                lifecycle_status, last_source_id)
             VALUES ($1, $2, $2, $3, 'candidate', 'draft', $4)
             RETURNING decision_id`,
            [config.tenantId, summary, safeText(candidate.reason, 4000) || null, sourceId],
          );
          await client.query(
            `INSERT INTO am_memory.decision_sources
               (tenant_id, decision_id, source_id, evidence_role, evidence_excerpt)
             VALUES ($1, $2, $3, 'basis', $4) ON CONFLICT DO NOTHING`,
            [config.tenantId, decision.rows[0].decision_id, sourceId,
              safeText(job.source?.content_text, 1000) || null],
          );
        }

        if (newlyInserted && eventType === 'information_observed' && candidate.knowledge_candidate === true) {
          const knowledgeKey = `candidate:${eventKey.slice(0, 32)}`;
          const knowledge = await client.query(
            `INSERT INTO am_memory.knowledge_items
               (tenant_id, knowledge_key, title, category, content,
                confirmation_status, lifecycle_status)
             VALUES ($1, $2, $3, $4, $3, 'candidate', 'candidate')
             ON CONFLICT (tenant_id, knowledge_key, version_no) DO NOTHING
             RETURNING knowledge_id`,
            [config.tenantId, knowledgeKey, summary, safeText(candidate.knowledge_category, 200) || 'conversation_candidate'],
          );
          if (knowledge.rows[0]?.knowledge_id) {
            await client.query(
              `INSERT INTO am_memory.knowledge_sources
                 (tenant_id, knowledge_id, source_id, evidence_role, evidence_excerpt)
               VALUES ($1, $2, $3, 'basis', $4) ON CONFLICT DO NOTHING`,
              [config.tenantId, knowledge.rows[0].knowledge_id, sourceId,
                safeText(job.source?.content_text, 1000) || null],
            );
          }
        }
        stored.push({ eventId, eventType, newlyInserted });
      }

      await client.query(
        `UPDATE am_memory.processing_jobs
            SET status = 'succeeded', output_payload = $3::jsonb,
                completed_at = clock_timestamp(), lease_owner = NULL, lease_expires_at = NULL
          WHERE tenant_id = $1 AND job_id = $2`,
        [config.tenantId, job.job_id, JSON.stringify({ eventCount: stored.length })],
      );
      await client.query(
        `UPDATE am_memory.raw_messages
            SET ingestion_status = 'processed'
          WHERE tenant_id = $1 AND source_id = $2`,
        [config.tenantId, sourceId],
      );
      return stored;
    });
    return result.skipped ? [] : result.value;
  }

  async function failJob(tenant, job, error) {
    try {
      await withTenant(tenant, async (client, config) => {
        const dead = Number(job.attempt_count) >= 8;
        await client.query(
          `UPDATE am_memory.processing_jobs
              SET status = $3,
                  available_at = CASE WHEN $3 = 'retry'
                    THEN clock_timestamp() + $4::interval ELSE available_at END,
                  last_error = jsonb_build_object('message', $5::text, 'at', clock_timestamp()),
                  lease_owner = NULL, lease_expires_at = NULL,
                  completed_at = CASE WHEN $3 = 'dead_letter' THEN clock_timestamp() ELSE NULL END
            WHERE tenant_id = $1 AND job_id = $2`,
          [config.tenantId, job.job_id, dead ? 'dead_letter' : 'retry',
            retryDelay(Number(job.attempt_count) || 1), safeText(error?.message || error, 1000)],
        );
        await client.query(
          `UPDATE am_memory.raw_messages
              SET ingestion_status = $3
            WHERE tenant_id = $1 AND source_id = $2`,
          [config.tenantId, job.source_id, dead ? 'dead_letter' : 'failed'],
        );
      });
    } catch (updateError) {
      logger.warn(`[operational-memory] unable to mark failed job (tenant=${tenant?.key || '?'}): ${updateError.message}`);
    }
  }

  async function snapshot(tenant) {
    const result = await withTenant(tenant, async (client, config) => {
      const counts = await client.query(
        `SELECT
           (SELECT count(*)::int FROM am_memory.source_records WHERE tenant_id = $1) AS sources,
           (SELECT count(*)::int FROM am_memory.processing_jobs WHERE tenant_id = $1 AND status IN ('queued','retry','leased')) AS queued_jobs,
           (SELECT count(*)::int FROM am_memory.events WHERE tenant_id = $1) AS events,
           (SELECT count(*)::int FROM am_memory.tasks WHERE tenant_id = $1 AND status = 'candidate') AS candidate_tasks,
           (SELECT count(*)::int FROM am_memory.decisions WHERE tenant_id = $1 AND confirmation_status = 'candidate') AS candidate_decisions,
           (SELECT count(*)::int FROM am_memory.knowledge_items WHERE tenant_id = $1 AND confirmation_status = 'candidate') AS candidate_knowledge`,
        [config.tenantId],
      );
      const recent = await client.query(
        `SELECT e.event_type, e.event_summary, e.confirmation_status, e.confidence, e.event_time,
                left(s.content_text, 500) AS evidence_excerpt
           FROM am_memory.events e
           LEFT JOIN am_memory.event_sources es
             ON es.tenant_id = e.tenant_id AND es.event_id = e.event_id
           LEFT JOIN am_memory.source_records s
             ON s.tenant_id = es.tenant_id AND s.source_id = es.source_id
          WHERE e.tenant_id = $1
          ORDER BY e.event_time DESC, e.created_at DESC LIMIT 30`,
        [config.tenantId],
      );
      return { counts: counts.rows[0], recent: recent.rows };
    });
    return result.skipped ? { counts: {}, recent: [], skipped: result.skipped } : result.value;
  }

  function status(tenant) {
    const config = tenantConfig(tenant, env);
    return {
      enabled: config.mode !== 'off',
      configured: config.configured,
      mode: config.mode,
      queryMode: config.queryMode,
      tenantIdConfigured: UUID_RE.test(config.tenantId),
      databaseConfigured: Boolean(config.databaseUrl),
      notionProjection: config.notionProjection,
      vectorSearch: config.vectorSearch,
      knowledgePromotion: config.knowledgePromotion,
    };
  }

  async function close() {
    await Promise.all([...pools.values()].map((pool) => pool.end?.().catch(() => {})));
    pools.clear();
  }

  return {
    status,
    ingestLineMessage,
    leaseJobs,
    loadStructuredContext,
    storeExtraction,
    failJob,
    snapshot,
    close,
    settingsForTenant: (tenant) => tenantConfig(tenant, env),
  };
}

export const __test = { tenantConfig, sanitizedEnvelope, occurredAt, normalize, sha256, EVENT_TYPES };
