// Contract evidence store — PostgreSQL-backed immutable versions and signing evidence.
// Production data belongs to the tenant database. This module only owns the runtime adapter.

import crypto from 'node:crypto';

const SCHEMA = 'engineering_contracts';
const SCHEMA_VERSION = '2026-08-28.engineering-contract-evidence.v1';

function envValue(env, tenant, name, fallback = '') {
  const prefix = String(tenant?.envPrefix || '').trim();
  return String((prefix && env[`${prefix}_${name}`]) || env[`AMCORE_${name}`] || fallback || '').trim();
}

function positiveInt(value, fallback, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function tlsError(code, message) {
  return Object.assign(new Error(message), { code, statusCode: 503 });
}

function parseCertificateAuthority(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  let certificate = source.includes('-----BEGIN CERTIFICATE-----')
    ? source.replace(/\\n/g, '\n')
    : '';
  if (!certificate && /^[A-Za-z0-9+/=\s]+$/.test(source)) {
    try { certificate = Buffer.from(source.replace(/\s/g, ''), 'base64').toString('utf8').trim(); } catch { certificate = ''; }
  }
  if (!/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----$/.test(certificate)) {
    throw tlsError('CONTRACT_DATABASE_CA_INVALID', 'Contract database CA must be a PEM certificate or base64-encoded PEM.');
  }
  return certificate;
}

function productionRuntime(env) {
  return String(env.NODE_ENV || '').toLowerCase() === 'production'
    || String(env.RENDER || '').toLowerCase() === 'true'
    || Boolean(String(env.RENDER_SERVICE_ID || '').trim());
}

function databaseTls(env, tenant, databaseUrl) {
  const legacyEnabled = envValue(env, tenant, 'CONTRACTS_DATABASE_SSL', '1') !== '0';
  const mode = envValue(env, tenant, 'CONTRACTS_DATABASE_SSL_MODE', legacyEnabled ? 'require' : 'disable').toLowerCase();
  if (!['disable', 'require', 'verify-full'].includes(mode)) {
    throw tlsError('CONTRACT_DATABASE_SSL_MODE_INVALID', 'Contract database SSL mode must be disable, require, or verify-full.');
  }
  let parsed;
  try { parsed = new URL(databaseUrl); } catch { throw tlsError('CONTRACT_DATABASE_URL_INVALID', 'Contract database URL is invalid.'); }
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) {
    if (parsed.searchParams.has(key)) {
      throw tlsError('CONTRACT_DATABASE_URL_TLS_OVERRIDE', `Contract database URL must not override ${key}; use dedicated environment settings.`);
    }
  }
  if (productionRuntime(env) && mode !== 'verify-full') {
    throw tlsError('CONTRACT_DATABASE_TLS_VERIFY_REQUIRED', 'Production contract database TLS must use verify-full.');
  }
  if (mode === 'disable') return { mode, caConfigured: false, ssl: undefined, fingerprint: 'disable' };
  if (mode === 'require') return { mode, caConfigured: false, ssl: { rejectUnauthorized: false }, fingerprint: 'require' };
  const ca = parseCertificateAuthority(envValue(env, tenant, 'CONTRACTS_DATABASE_CA'));
  if (!ca) throw tlsError('CONTRACT_DATABASE_CA_REQUIRED', 'verify-full requires a trusted contract database CA.');
  return {
    mode,
    caConfigured: true,
    ssl: { rejectUnauthorized: true, ca },
    fingerprint: `verify-full:${sha256(ca)}`,
  };
}

async function insertOutboxRow(client, input) {
  const payload = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
    ? input.payload : {};
  const payloadJson = canonical(payload);
  const payloadSha256 = sha256(payloadJson);
  const result = await client.query(
    `INSERT INTO ${SCHEMA}.integration_outbox
       (contract_id, signing_session_id, event_kind, idempotency_key, payload, payload_sha256, available_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,COALESCE($7::timestamptz,clock_timestamp()))
     ON CONFLICT (idempotency_key) DO UPDATE SET
       updated_at = ${SCHEMA}.integration_outbox.updated_at
     WHERE ${SCHEMA}.integration_outbox.payload_sha256 = EXCLUDED.payload_sha256
       AND ${SCHEMA}.integration_outbox.event_kind = EXCLUDED.event_kind
     RETURNING *`,
    [input.contractId || null, input.signingSessionId || null, input.eventKind,
      input.idempotencyKey, payloadJson, payloadSha256, input.availableAt || null],
  );
  if (!result.rowCount) {
    throw Object.assign(new Error('Outbox idempotency key was reused with different content.'), {
      code: 'OUTBOX_IDEMPOTENCY_CONFLICT', statusCode: 409,
    });
  }
  return result.rows[0];
}

function configFor(env, tenant) {
  const databaseUrl = envValue(env, tenant, 'CONTRACTS_DATABASE_URL');
  if (!databaseUrl) return {
    configured: false, databaseUrl: '', databaseSsl: false, databaseSslMode: 'disable',
    databaseCaConfigured: false, tenantKey: String(tenant?.key || ''), tls: null,
  };
  const tls = databaseTls(env, tenant, databaseUrl);
  return {
    configured: Boolean(databaseUrl),
    databaseUrl,
    databaseSsl: tls.mode !== 'disable',
    databaseSslMode: tls.mode,
    databaseCaConfigured: tls.caConfigured,
    tenantKey: String(tenant?.key || ''),
    tls,
  };
}

function publicConfig(config) {
  return {
    configured: config.configured,
    databaseSsl: config.databaseSsl,
    databaseSslMode: config.databaseSslMode,
    databaseCaConfigured: config.databaseCaConfigured,
    tenantKey: config.tenantKey,
  };
}

export function createContractStore({ env = process.env, logger = console, poolFactory = null } = {}) {
  const pools = new Map();

  async function poolFor(config) {
    if (!config.databaseUrl) return null;
    const poolKey = `${config.databaseUrl}\u0000${config.tls?.fingerprint || 'disable'}`;
    if (pools.has(poolKey)) return pools.get(poolKey);
    let factory = poolFactory;
    if (!factory) {
      const pg = await import('pg');
      factory = (options) => new pg.Pool(options);
    }
    const pool = factory({
      connectionString: config.databaseUrl,
      ssl: config.tls?.ssl,
      max: positiveInt(env.AMCORE_CONTRACTS_POOL_SIZE, 4, 20),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      application_name: 'am-platform-engineering-contracts',
    });
    pools.set(poolKey, pool);
    return pool;
  }

  async function withTenant(tenant, work, { readOnly = false } = {}) {
    const config = configFor(env, tenant);
    if (!config.configured) {
      return { skipped: 'database-not-configured', config };
    }
    if (!config.tenantKey) throw new Error('Contract store requires tenant key.');
    const pool = await poolFor(config);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (readOnly) await client.query('SET TRANSACTION READ ONLY');
      await client.query("SELECT set_config('app.tenant_key', $1, true)", [config.tenantKey]);
      const value = await work(client, config);
      await client.query('COMMIT');
      return { value, config: publicConfig(config) };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function status(tenant) {
    const config = configFor(env, tenant);
    if (!config.configured) return { configured: false, schemaReady: false };
    try {
      const result = await withTenant(tenant, async (client) => client.query(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables
            WHERE table_schema = $1 AND table_name = 'signing_sessions'
         ) AS ready,
         (SELECT version FROM ${SCHEMA}.schema_meta WHERE singleton = true) AS schema_version`,
        [SCHEMA],
      ), { readOnly: true });
      const schemaVersion = String(result.value.rows[0]?.schema_version || '');
      return {
        configured: true,
        schemaReady: Boolean(result.value.rows[0]?.ready && schemaVersion === SCHEMA_VERSION),
        schemaVersion,
      };
    } catch (error) {
      logger.warn?.(`Contract store status failed (tenant=${tenant?.key || '-'}): ${error.message}`);
      return { configured: true, schemaReady: false, error: 'contract-store-unavailable' };
    }
  }

  async function upsertContract(tenant, input) {
    return withTenant(tenant, async (client, config) => {
      const result = await client.query(
        `INSERT INTO ${SCHEMA}.contracts
           (tenant_key, project_notion_page_id, project_code, notion_contract_page_id, contract_number,
            title, trade, counterparty_name, counterparty_company, counterparty_title,
            amount, currency, workflow_state, execution_status,
            budget_item_notion_page_id, group_binding_notion_page_id, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)
         ON CONFLICT (tenant_key, notion_contract_page_id) DO UPDATE SET
           project_notion_page_id = EXCLUDED.project_notion_page_id,
           project_code = EXCLUDED.project_code,
           contract_number = EXCLUDED.contract_number,
           title = EXCLUDED.title,
           trade = EXCLUDED.trade,
           counterparty_name = EXCLUDED.counterparty_name,
           counterparty_company = EXCLUDED.counterparty_company,
           counterparty_title = EXCLUDED.counterparty_title,
           amount = EXCLUDED.amount,
           currency = EXCLUDED.currency,
           budget_item_notion_page_id = EXCLUDED.budget_item_notion_page_id,
           group_binding_notion_page_id = EXCLUDED.group_binding_notion_page_id,
           updated_by = EXCLUDED.updated_by,
           updated_at = now(), row_version = ${SCHEMA}.contracts.row_version + 1
         WHERE NOT EXISTS (
           SELECT 1 FROM ${SCHEMA}.contract_versions frozen_version
            WHERE frozen_version.id = ${SCHEMA}.contracts.current_version_id
              AND frozen_version.status IN ('frozen','issued','superseded')
         ) OR (
           ${SCHEMA}.contracts.project_notion_page_id IS NOT DISTINCT FROM EXCLUDED.project_notion_page_id
           AND ${SCHEMA}.contracts.project_code IS NOT DISTINCT FROM EXCLUDED.project_code
           AND ${SCHEMA}.contracts.contract_number IS NOT DISTINCT FROM EXCLUDED.contract_number
           AND ${SCHEMA}.contracts.title IS NOT DISTINCT FROM EXCLUDED.title
           AND ${SCHEMA}.contracts.trade IS NOT DISTINCT FROM EXCLUDED.trade
           AND ${SCHEMA}.contracts.counterparty_name IS NOT DISTINCT FROM EXCLUDED.counterparty_name
           AND ${SCHEMA}.contracts.counterparty_company IS NOT DISTINCT FROM EXCLUDED.counterparty_company
           AND ${SCHEMA}.contracts.counterparty_title IS NOT DISTINCT FROM EXCLUDED.counterparty_title
           AND ${SCHEMA}.contracts.amount IS NOT DISTINCT FROM EXCLUDED.amount
           AND ${SCHEMA}.contracts.currency IS NOT DISTINCT FROM EXCLUDED.currency
           AND ${SCHEMA}.contracts.budget_item_notion_page_id IS NOT DISTINCT FROM EXCLUDED.budget_item_notion_page_id
           AND ${SCHEMA}.contracts.group_binding_notion_page_id IS NOT DISTINCT FROM EXCLUDED.group_binding_notion_page_id
         )
         RETURNING *`,
        [config.tenantKey, input.projectId, input.projectCode || '', input.notionContractPageId, input.contractNumber,
          input.title, input.trade || null, input.counterpartyName || null, input.counterpartyCompany || null,
          input.counterpartyTitle || null, input.amount ?? null, input.currency || 'TWD',
          input.workflowState || 'draft', input.executionStatus || 'not_started',
          input.budgetItemId || null, input.groupBindingId || null, input.actor],
      );
      if (!result.rowCount) {
        throw Object.assign(new Error('凍結或已簽發合約的關鍵資料不可原地變更，請建立新版本'), {
          code: 'FROZEN_CONTRACT_METADATA_IMMUTABLE', statusCode: 409,
        });
      }
      return result.rows[0];
    });
  }

  async function createVersion(tenant, input) {
    return withTenant(tenant, async (client) => {
      const result = await client.query(
        `INSERT INTO ${SCHEMA}.contract_versions
           (contract_id, version_no, status, contract_snapshot, bundle_manifest, bundle_sha256, created_by)
         SELECT $1,$2,$3,$4::jsonb,$5::jsonb,$6,$7
          WHERE EXISTS (
            SELECT 1 FROM ${SCHEMA}.contracts c WHERE c.id = $1 AND c.tenant_key = $8
          )
         RETURNING *`,
        [input.contractId, input.versionNo, input.status || 'draft', JSON.stringify(input.snapshot), JSON.stringify(input.manifest || []),
          input.bundleSha256, input.actor, tenant.key],
      );
      if (!result.rowCount) throw new Error('Contract not found in tenant scope.');
      const version = result.rows[0];
      const manifest = Array.isArray(input.manifest) ? input.manifest : [];
      let ordinal = 0;
      for (const document of manifest) {
        if (!document.fileId || !document.sha256 || !document.mimeType || !Number(document.sizeBytes)) continue;
        ordinal += 1;
        await client.query(
          `INSERT INTO ${SCHEMA}.contract_documents
             (version_id, document_kind, ordinal, drive_file_id, file_name, mime_type, byte_size, sha256, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [version.id, document.category, ordinal, document.fileId, document.name, document.mimeType,
            Number(document.sizeBytes), document.sha256, input.actor],
        );
      }
      const documentPackage = input.documentPackage || input.snapshot?.documentPackage || {};
      const milestones = Array.isArray(documentPackage.paymentMilestones) ? documentPackage.paymentMilestones : [];
      for (let index = 0; index < milestones.length; index += 1) {
        const milestone = milestones[index] || {};
        const fixedDueAt = milestone.dueAt || (milestone.dueDate
          ? `${milestone.dueDate}T${milestone.dueTime || '23:59'}:00+08:00`
          : null);
        const triggerText = milestone.trigger || milestone.condition || null;
        await client.query(
          `INSERT INTO ${SCHEMA}.payment_milestones
             (version_id, sequence_no, label, trigger_kind, fixed_due_at, time_zone,
              trigger_text, amount, percentage, details)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [version.id, index + 1, milestone.label || milestone.name || `第 ${index + 1} 期`,
            fixedDueAt ? 'fixed_datetime' : 'milestone', fixedDueAt,
            milestone.timezone || 'Asia/Taipei', triggerText,
            milestone.amount ?? null, milestone.percentage ?? null,
            milestone.evidenceRequired || milestone.details || ''],
        );
      }
      const criteria = Array.isArray(documentPackage.acceptanceCriteria)
        ? documentPackage.acceptanceCriteria
        : Array.isArray(documentPackage.acceptanceStandards) ? documentPackage.acceptanceStandards : [];
      for (let index = 0; index < criteria.length; index += 1) {
        const item = typeof criteria[index] === 'string' ? { criterion: criteria[index] } : (criteria[index] || {});
        await client.query(
          `INSERT INTO ${SCHEMA}.acceptance_criteria
             (version_id, sequence_no, criterion, reference, verifier,
              verification_method, pass_condition, evidence_required)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [version.id, index + 1, item.criterion || item.standard || item.description,
            item.reference || item.drawingReference || '', item.verifier || '',
            item.verificationMethod || '', item.passCondition || '',
            item.evidenceRequired || item.evidence || ''],
        );
      }
      await client.query(
        `UPDATE ${SCHEMA}.contracts
            SET current_version_id = $2, workflow_state = 'draft', updated_by = $3,
                updated_at = now(), row_version = row_version + 1
          WHERE id = $1 AND tenant_key = $4`,
        [input.contractId, version.id, input.actor, tenant.key],
      );
      return version;
    });
  }

  async function getContract(tenant, selector = {}) {
    const result = await withTenant(tenant, async (client) => client.query(
      `SELECT * FROM ${SCHEMA}.contracts
        WHERE tenant_key = $1
          AND (($2::uuid IS NOT NULL AND id = $2::uuid)
            OR ($3::text IS NOT NULL AND notion_contract_page_id = $3::text))
        LIMIT 1`,
      [tenant.key, selector.contractId || null, selector.notionContractPageId || null],
    ), { readOnly: true });
    return result.value.rows[0] || null;
  }

  async function listVersions(tenant, contractId) {
    const result = await withTenant(tenant, async (client) => client.query(
      `SELECT v.* FROM ${SCHEMA}.contract_versions v
         JOIN ${SCHEMA}.contracts c ON c.id = v.contract_id
        WHERE c.tenant_key = $1 AND c.id = $2
        ORDER BY v.version_no DESC`,
      [tenant.key, contractId],
    ), { readOnly: true });
    return result.value.rows;
  }

  async function getVersion(tenant, versionId) {
    const result = await withTenant(tenant, async (client) => client.query(
      `SELECT v.* FROM ${SCHEMA}.contract_versions v
         JOIN ${SCHEMA}.contracts c ON c.id = v.contract_id
        WHERE c.tenant_key = $1 AND v.id = $2
        LIMIT 1`,
      [tenant.key, versionId],
    ), { readOnly: true });
    return result.value.rows[0] || null;
  }

  async function transitionVersion(tenant, input) {
    return withTenant(tenant, async (client) => {
      const result = await client.query(
        `UPDATE ${SCHEMA}.contract_versions v
            SET status = $4, updated_at = now(),
                reviewed_at = CASE WHEN $4 = 'internal_review' THEN COALESCE(reviewed_at, $5::timestamptz) ELSE reviewed_at END,
                reviewed_by = CASE WHEN $4 = 'internal_review' THEN COALESCE(reviewed_by, $6) ELSE reviewed_by END,
                approved_at = CASE WHEN $4 = 'approved' THEN COALESCE(approved_at, $5::timestamptz) ELSE approved_at END,
                approved_by = CASE WHEN $4 = 'approved' THEN COALESCE(approved_by, $6) ELSE approved_by END
           FROM ${SCHEMA}.contracts c
          WHERE v.id = $1 AND v.contract_id = $2 AND c.id = v.contract_id
            AND c.tenant_key = $3 AND v.status = $7
          RETURNING v.*`,
        [input.versionId, input.contractId, tenant.key, input.status, input.transitionedAt, input.actor, input.expectedStatus],
      );
      const version = result.rows[0] || null;
      if (version) {
        await client.query(
          `UPDATE ${SCHEMA}.contracts
              SET workflow_state = $2, updated_by = $3, updated_at = now(), row_version = row_version + 1
            WHERE id = $1 AND tenant_key = $4`,
          [input.contractId, input.status === 'internal_review' ? 'internal_review' : 'ready_to_issue', input.actor, tenant.key],
        );
      }
      return version;
    });
  }

  async function freezeStoredVersion(tenant, input) {
    return withTenant(tenant, async (client) => {
      const result = await client.query(
        `UPDATE ${SCHEMA}.contract_versions v
            SET status = 'frozen', frozen_at = $4, frozen_by = $5,
                bundle_manifest = $6::jsonb, bundle_sha256 = $7, updated_at = now()
           FROM ${SCHEMA}.contracts c
          WHERE v.id = $1 AND v.contract_id = $2 AND c.id = v.contract_id
            AND c.tenant_key = $3 AND v.status = $8
          RETURNING v.*`,
        [input.versionId, input.contractId, tenant.key, input.frozenAt, input.frozenBy,
          JSON.stringify(input.manifest || []), input.attachmentManifestHash, input.expectedStatus],
      );
      const version = result.rows[0] || null;
      if (version) {
        await client.query(
          `UPDATE ${SCHEMA}.contracts
              SET workflow_state = 'ready_to_issue', updated_by = $2,
                  updated_at = now(), row_version = row_version + 1
            WHERE id = $1 AND tenant_key = $3`,
          [input.contractId, input.actor, tenant.key],
        );
      }
      return version;
    });
  }

  async function issueVersion(tenant, input) {
    if (!/^[a-f0-9]{64}$/.test(String(input.issuedPdfSha256 || ''))) throw new Error('Issued PDF SHA-256 is required.');
    if (!Number.isSafeInteger(Number(input.byteSize)) || Number(input.byteSize) <= 0) throw new Error('Issued PDF byte size is required.');
    return withTenant(tenant, async (client) => {
      const result = await client.query(
        `UPDATE ${SCHEMA}.contract_versions v
            SET status = 'issued', issued_at = COALESCE(v.issued_at, $4::timestamptz),
                issued_by = COALESCE(v.issued_by, $5),
                issued_pdf_drive_file_id = $6, issued_pdf_sha256 = $7, updated_at = now()
           FROM ${SCHEMA}.contracts c
          WHERE v.id = $1 AND v.contract_id = $2 AND c.id = v.contract_id
            AND c.tenant_key = $3 AND v.status = 'frozen' AND v.issued_at IS NULL
          RETURNING v.*`,
        [input.versionId, input.contractId, tenant.key, input.issuedAt || new Date().toISOString(),
          input.actor, input.issuedPdfDriveFileId, input.issuedPdfSha256],
      );
      if (!result.rowCount) throw Object.assign(new Error('合約版本不存在或已經簽發'), { code: 'VERSION_ALREADY_ISSUED' });
      const version = result.rows[0];
      await client.query(
        `UPDATE ${SCHEMA}.contracts
            SET current_version_id = $2, workflow_state = 'issued', updated_by = $3,
                updated_at = now(), row_version = row_version + 1
          WHERE id = $1 AND tenant_key = $4`,
        [input.contractId, version.id, input.actor, tenant.key],
      );
      await client.query(
        `INSERT INTO ${SCHEMA}.artifacts
           (version_id, signing_session_id, artifact_kind, drive_file_id, sha256, byte_size, metadata)
         VALUES ($1,NULL,'issued_pdf',$2,$3,$4,$5::jsonb)`,
        [version.id, input.issuedPdfDriveFileId, input.issuedPdfSha256,
          Number(input.byteSize), JSON.stringify(input.metadata || {})],
      );
      for (const item of Array.isArray(input.outbox) ? input.outbox : []) {
        await insertOutboxRow(client, { ...item, contractId: version.contract_id });
      }
      return version;
    });
  }

  async function enqueueOutbox(tenant, input) {
    return withTenant(tenant, async (client) => {
      const contractId = String(input.contractId || '').trim();
      if (!contractId) throw new Error('Outbox requires contractId.');
      const scoped = await client.query(
        `SELECT id FROM ${SCHEMA}.contracts WHERE tenant_key = $1 AND id = $2`,
        [tenant.key, contractId],
      );
      if (!scoped.rowCount) throw Object.assign(new Error('Contract not found in tenant scope.'), { statusCode: 404 });
      return insertOutboxRow(client, input);
    });
  }

  async function getOutboxByKey(tenant, idempotencyKey) {
    const result = await withTenant(tenant, async (client) => client.query(
      `SELECT o.*, s.external_session_id FROM ${SCHEMA}.integration_outbox o
         LEFT JOIN ${SCHEMA}.contracts c ON c.id = o.contract_id
         LEFT JOIN ${SCHEMA}.signing_sessions s ON s.id = o.signing_session_id
         LEFT JOIN ${SCHEMA}.contract_versions v ON v.id = s.version_id
        WHERE o.idempotency_key = $2
          AND COALESCE(c.tenant_key, (SELECT tenant_key FROM ${SCHEMA}.contracts WHERE id = v.contract_id)) = $1
        LIMIT 1`,
      [tenant.key, idempotencyKey],
    ), { readOnly: true });
    return result.value.rows[0] || null;
  }

  async function claimOutbox(tenant, input = {}) {
    const limit = Math.max(1, Math.min(Number(input.limit || 1), 25));
    const kinds = Array.isArray(input.eventKinds) ? input.eventKinds.filter(Boolean) : null;
    const key = String(input.idempotencyKey || '').trim() || null;
    const workerId = String(input.workerId || '').trim();
    if (!workerId) throw new Error('Outbox claim requires workerId.');
    return withTenant(tenant, async (client) => {
      const result = await client.query(
        `WITH ready AS (
           SELECT o.id
             FROM ${SCHEMA}.integration_outbox o
             LEFT JOIN ${SCHEMA}.contracts c ON c.id = o.contract_id
             LEFT JOIN ${SCHEMA}.signing_sessions s ON s.id = o.signing_session_id
             LEFT JOIN ${SCHEMA}.contract_versions v ON v.id = s.version_id
            WHERE COALESCE(c.tenant_key, (SELECT tenant_key FROM ${SCHEMA}.contracts WHERE id = v.contract_id)) = $1
              AND ($2::text IS NULL OR o.idempotency_key = $2)
              AND ($3::text[] IS NULL OR o.event_kind = ANY($3::text[]))
              AND (
                (o.status IN ('pending','failed') AND o.available_at <= clock_timestamp())
                OR (o.status = 'processing' AND o.locked_at < clock_timestamp() - interval '5 minutes')
              )
            ORDER BY o.available_at, o.created_at
            FOR UPDATE OF o SKIP LOCKED
            LIMIT $4
         )
         , updated AS (
         UPDATE ${SCHEMA}.integration_outbox o
            SET status = 'processing', attempts = o.attempts + 1,
                locked_at = clock_timestamp(), locked_by = $5, updated_at = clock_timestamp()
           FROM ready WHERE o.id = ready.id
         RETURNING o.*)
         SELECT updated.*, s.external_session_id
           FROM updated LEFT JOIN ${SCHEMA}.signing_sessions s ON s.id = updated.signing_session_id`,
        [tenant.key, key, kinds, limit, workerId],
      );
      return result.rows;
    });
  }

  async function linkOutboxSession(tenant, input) {
    return withTenant(tenant, async (client) => {
      const result = await client.query(
        `UPDATE ${SCHEMA}.integration_outbox o
            SET signing_session_id = s.id, updated_at = clock_timestamp()
           FROM ${SCHEMA}.signing_sessions s
           JOIN ${SCHEMA}.contract_versions v ON v.id = s.version_id
           JOIN ${SCHEMA}.contracts c ON c.id = v.contract_id
          WHERE o.id = $2 AND o.status = 'processing' AND o.locked_by = $3
            AND c.tenant_key = $1 AND c.id = o.contract_id AND s.external_session_id = $4
          RETURNING o.*`,
        [tenant.key, input.id, input.workerId, input.externalSessionId],
      );
      return result.rows[0] || null;
    });
  }

  async function completeOutbox(tenant, input) {
    return withTenant(tenant, async (client) => {
      const result = await client.query(
        `UPDATE ${SCHEMA}.integration_outbox o
            SET status = 'succeeded', processed_at = clock_timestamp(), last_error = NULL,
                locked_at = NULL, locked_by = NULL, updated_at = clock_timestamp(),
                signing_session_id = COALESCE(o.signing_session_id, (
                  SELECT s.id FROM ${SCHEMA}.signing_sessions s
                   JOIN ${SCHEMA}.contract_versions v ON v.id = s.version_id
                   JOIN ${SCHEMA}.contracts c ON c.id = v.contract_id
                  WHERE c.tenant_key = $1 AND s.external_session_id = $4
                ))
          WHERE o.id = $2 AND o.status = 'processing' AND o.locked_by = $3
            AND EXISTS (SELECT 1 FROM ${SCHEMA}.contracts c WHERE c.id = o.contract_id AND c.tenant_key = $1)
          RETURNING o.*`,
        [tenant.key, input.id, input.workerId, input.externalSessionId || null],
      );
      return result.rows[0] || null;
    });
  }

  async function failOutbox(tenant, input) {
    return withTenant(tenant, async (client) => {
      const maxAttempts = Math.max(1, Math.min(Number(input.maxAttempts || 8), 50));
      const delaySeconds = Math.max(1, Math.min(Number(input.delaySeconds || 30), 86400));
      const result = await client.query(
        `UPDATE ${SCHEMA}.integration_outbox o
            SET status = CASE WHEN o.attempts >= $4 THEN 'dead_letter' ELSE 'failed' END,
                available_at = CASE WHEN o.attempts >= $4 THEN o.available_at
                  ELSE clock_timestamp() + make_interval(secs => $5) END,
                last_error = left($6, 2000), locked_at = NULL, locked_by = NULL,
                updated_at = clock_timestamp()
          WHERE o.id = $2 AND o.status = 'processing' AND o.locked_by = $3
            AND EXISTS (SELECT 1 FROM ${SCHEMA}.contracts c WHERE c.id = o.contract_id AND c.tenant_key = $1)
          RETURNING o.*`,
        [tenant.key, input.id, input.workerId, maxAttempts, delaySeconds, String(input.error || 'outbox processing failed')],
      );
      return result.rows[0] || null;
    });
  }

  async function recordArtifact(tenant, input) {
    if (!['signed_pdf', 'evidence_receipt'].includes(input.artifactKind)) throw new Error('Unsupported signing artifact kind.');
    if (!/^[a-f0-9]{64}$/.test(String(input.sha256 || ''))) throw new Error('Artifact SHA-256 is required.');
    if (!Number.isSafeInteger(Number(input.byteSize)) || Number(input.byteSize) <= 0) throw new Error('Artifact byte size is required.');
    return withTenant(tenant, async (client) => {
      const result = await client.query(
        `INSERT INTO ${SCHEMA}.artifacts
           (version_id, signing_session_id, artifact_kind, drive_file_id, sha256, byte_size, metadata)
         SELECT $1, s.id, $3, $4, $5, $6, $7::jsonb
           FROM ${SCHEMA}.signing_sessions s
           JOIN ${SCHEMA}.contract_versions v ON v.id = s.version_id
           JOIN ${SCHEMA}.contracts c ON c.id = v.contract_id
          WHERE v.id = $1 AND s.external_session_id = $2 AND c.tenant_key = $8
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [input.versionId, input.sessionId, input.artifactKind, input.driveFileId,
          input.sha256, Number(input.byteSize), JSON.stringify(input.metadata || {}), tenant.key],
      );
      return result.rows[0] || null;
    });
  }

  async function getSigningBundle(tenant, externalSessionId) {
    const result = await withTenant(tenant, async (client) => {
      const header = await client.query(
        `SELECT s.id AS signing_session_db_id, s.external_session_id, s.status AS signing_status,
                s.state_snapshot, s.row_version, s.issued_at AS session_issued_at,
                s.sent_at, s.received_at, s.signed_at, s.confirmed_at, s.completed_at,
                v.*, c.project_notion_page_id, c.project_code, c.notion_contract_page_id, c.contract_number,
                c.title AS contract_title, c.counterparty_name, c.counterparty_company,
                c.counterparty_title, c.amount, c.currency, c.group_binding_notion_page_id,
                sg.verified_signer_line_user_id, sg.verified_signer_name,
                sg.signature_drive_file_id, sg.signature_sha256, sg.ip_address::text AS signature_ip_address,
                sg.user_agent AS signature_user_agent, sg.consent_version, sg.liff_verified,
                sg.group_member_verified, sg.specified_user_matched, sg.bundle_sha256 AS signature_bundle_sha256,
                sg.signed_at AS signature_signed_at, sg.evidence_snapshot, sg.evidence_sha256
           FROM ${SCHEMA}.signing_sessions s
           JOIN ${SCHEMA}.contract_versions v ON v.id = s.version_id
           JOIN ${SCHEMA}.contracts c ON c.id = v.contract_id
           LEFT JOIN ${SCHEMA}.signatures sg ON sg.signing_session_id = s.id
          WHERE c.tenant_key = $1 AND s.external_session_id = $2
          LIMIT 1`,
        [tenant.key, externalSessionId],
      );
      if (!header.rowCount) return null;
      const events = await client.query(
        `SELECT sequence_no, event_type, occurred_at, recorded_at, ip_address::text AS ip_address,
                user_agent, actor_kind, actor_id, payload, previous_event_hash, event_hash
           FROM ${SCHEMA}.signing_events
          WHERE session_id = $1 ORDER BY sequence_no`,
        [header.rows[0].signing_session_db_id],
      );
      const artifacts = await client.query(
        `SELECT artifact_kind, drive_file_id, sha256, byte_size, created_at, metadata
           FROM ${SCHEMA}.artifacts
          WHERE version_id = $1 AND (signing_session_id = $2 OR signing_session_id IS NULL)
          ORDER BY created_at`,
        [header.rows[0].id, header.rows[0].signing_session_db_id],
      );
      const row = header.rows[0];
      return {
        contract: {
          id: row.contract_id,
          projectId: row.project_notion_page_id,
          projectCode: row.project_code,
          notionContractPageId: row.notion_contract_page_id,
          contractNumber: row.contract_number,
          title: row.contract_title,
          counterpartyName: row.counterparty_name,
          counterpartyCompany: row.counterparty_company,
          counterpartyTitle: row.counterparty_title,
          amount: row.amount,
          currency: row.currency,
          groupBindingId: row.group_binding_notion_page_id,
        },
        version: {
          id: row.id,
          contractId: row.contract_id,
          versionNo: row.version_no,
          status: row.status,
          contractSnapshot: row.contract_snapshot,
          bundleManifest: row.bundle_manifest,
          bundleSha256: row.bundle_sha256,
          issuedPdfDriveFileId: row.issued_pdf_drive_file_id,
          issuedPdfSha256: row.issued_pdf_sha256,
          issuedAt: row.issued_at,
        },
        session: {
          ...(row.state_snapshot || {}),
          externalSessionId: row.external_session_id,
          versionId: row.id,
          status: row.signing_status,
          issuedAt: row.session_issued_at,
          sentAt: row.sent_at,
          receivedAt: row.received_at,
          signedAt: row.signed_at,
          confirmedAt: row.confirmed_at,
          completedAt: row.completed_at,
          rowVersion: row.row_version,
        },
        signatureEvidence: row.signature_drive_file_id ? {
          verifiedSignerLineUserId: row.verified_signer_line_user_id,
          verifiedSignerName: row.verified_signer_name,
          signatureDriveFileId: row.signature_drive_file_id,
          signatureSha256: row.signature_sha256,
          ipAddress: row.signature_ip_address,
          userAgent: row.signature_user_agent,
          consentVersion: row.consent_version,
          liffVerified: row.liff_verified,
          groupMemberVerified: row.group_member_verified,
          specifiedUserMatched: row.specified_user_matched,
          bundleSha256: row.signature_bundle_sha256,
          signedAt: row.signature_signed_at,
          evidenceSnapshot: row.evidence_snapshot,
          evidenceSha256: row.evidence_sha256,
        } : {},
        events: events.rows,
        artifacts: artifacts.rows,
      };
    }, { readOnly: true });
    return result.value;
  }

  async function appendSnapshotEvents(client, sessionDbId, previousEvents, nextEvents) {
    const oldCount = Array.isArray(previousEvents) ? previousEvents.length : 0;
    const incoming = Array.isArray(nextEvents) ? nextEvents : [];
    if (incoming.length < oldCount) throw new Error('Signing event history cannot shrink.');
    const prefixMatches = (previousEvents || []).every((event, index) => canonical(event) === canonical(incoming[index]));
    if (!prefixMatches) throw new Error('Existing signing events cannot be modified.');
    let previousHash = null;
    let sequence = 0;
    const last = await client.query(
      `SELECT sequence_no, event_hash FROM ${SCHEMA}.signing_events
        WHERE session_id = $1 ORDER BY sequence_no DESC LIMIT 1`,
      [sessionDbId],
    );
    if (last.rowCount) {
      sequence = Number(last.rows[0].sequence_no || 0);
      previousHash = last.rows[0].event_hash || null;
    }
    for (const event of incoming.slice(oldCount)) {
      sequence += 1;
      const payload = event.metadata || {};
      const eventBody = {
        sessionId: sessionDbId,
        sequence,
        eventType: event.type,
        occurredAt: event.at,
        ipAddress: event.ip || null,
        userAgent: event.userAgent || null,
        actorKind: event.actorType,
        actorId: event.actorId || null,
        payload,
        previousHash,
      };
      const eventHash = sha256(canonical(eventBody));
      await client.query(
        `INSERT INTO ${SCHEMA}.signing_events
           (session_id, sequence_no, event_type, idempotency_key, occurred_at,
            ip_address, user_agent, actor_kind, actor_id, payload, previous_event_hash, event_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)`,
        [sessionDbId, sequence, event.type, event.idempotencyKeyHash, event.at,
          event.ip || null, event.userAgent || null, event.actorType, event.actorId || null,
          JSON.stringify(payload), previousHash, eventHash],
      );
      previousHash = eventHash;
    }
  }

  function signingStorage(tenant, context = {}) {
    const required = (value, name) => {
      const normalized = String(value || '').trim();
      if (!normalized) throw new Error(`contract signing storage requires ${name}`);
      return normalized;
    };
    return {
      async create(session) {
        const result = await withTenant(tenant, async (client) => {
          const inserted = await client.query(
            `INSERT INTO ${SCHEMA}.signing_sessions
               (external_session_id, version_id, expected_signer_line_user_id,
                expected_signer_name, expected_signer_company, expected_signer_title,
                group_binding_notion_page_id, line_group_id, token_digest, status,
                issued_at, expires_at, issued_by, state_snapshot, row_version)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)
             ON CONFLICT (external_session_id) DO NOTHING
             RETURNING id`,
            [session.id, required(context.versionId, 'versionId'), session.signerLineUserId,
              context.expectedSignerName || '指定簽署人', context.expectedSignerCompany || null,
              context.expectedSignerTitle || null, required(context.groupBindingId, 'groupBindingId'),
              session.lineGroupId, session.tokenHash, session.status, session.issuedAt,
              session.expiresAt, required(context.actor, 'actor'), JSON.stringify(session), Number(session.version || 1)],
          );
          if (!inserted.rowCount) return false;
          await appendSnapshotEvents(client, inserted.rows[0].id, [], session.events || []);
          return true;
        });
        return result.value;
      },

      async getById(externalSessionId) {
        const result = await withTenant(tenant, async (client) => client.query(
          `SELECT s.state_snapshot FROM ${SCHEMA}.signing_sessions s
             JOIN ${SCHEMA}.contract_versions v ON v.id = s.version_id
             JOIN ${SCHEMA}.contracts c ON c.id = v.contract_id
            WHERE c.tenant_key = $1 AND s.external_session_id = $2`,
          [tenant.key, externalSessionId],
        ), { readOnly: true });
        return result.value.rows[0]?.state_snapshot || null;
      },

      async getByTokenHash(tokenHash) {
        const result = await withTenant(tenant, async (client) => client.query(
          `SELECT s.state_snapshot FROM ${SCHEMA}.signing_sessions s
             JOIN ${SCHEMA}.contract_versions v ON v.id = s.version_id
             JOIN ${SCHEMA}.contracts c ON c.id = v.contract_id
            WHERE c.tenant_key = $1 AND s.token_digest = $2`,
          [tenant.key, tokenHash],
        ), { readOnly: true });
        return result.value.rows[0]?.state_snapshot || null;
      },

      async compareAndSwap(externalSessionId, expectedVersion, nextSession) {
        const result = await withTenant(tenant, async (client) => {
          const locked = await client.query(
            `SELECT s.id, s.state_snapshot, s.row_version, s.expected_signer_name,
                    v.bundle_sha256, c.id AS contract_id
               FROM ${SCHEMA}.signing_sessions s
               JOIN ${SCHEMA}.contract_versions v ON v.id = s.version_id
               JOIN ${SCHEMA}.contracts c ON c.id = v.contract_id
              WHERE c.tenant_key = $1 AND s.external_session_id = $2
              FOR UPDATE OF s`,
            [tenant.key, externalSessionId],
          );
          if (!locked.rowCount || Number(locked.rows[0].row_version) !== Number(expectedVersion)) return false;
          const previous = locked.rows[0].state_snapshot || {};
          if (String(previous.tokenHash || '') !== String(nextSession.tokenHash || '')) {
            throw new Error('Signing token digest is immutable.');
          }
          await appendSnapshotEvents(client, locked.rows[0].id, previous.events || [], nextSession.events || []);
          if (previous.status !== 'signed' && nextSession.status === 'signed') {
            const signedEvent = (nextSession.events || []).find((event) => event.type === 'signed');
            const submission = nextSession.submission || {};
            const evidence = {
              externalSessionId,
              signerLineUserId: signedEvent?.actorId || nextSession.signerLineUserId,
              signerName: locked.rows[0].expected_signer_name,
              signedAt: signedEvent?.at,
              ipAddress: signedEvent?.ip,
              userAgent: signedEvent?.userAgent,
              documentHash: submission.documentHash,
              signatureHash: submission.signatureHash,
              signatureDriveFileId: submission.submissionRef,
              consentVersion: submission.consentVersion,
              liffVerified: true,
              groupMemberVerified: true,
              specifiedUserMatched: true,
            };
            await client.query(
              `INSERT INTO ${SCHEMA}.signatures
                 (signing_session_id, verified_signer_line_user_id, verified_signer_name,
                  signature_drive_file_id, signature_sha256, ip_address, user_agent,
                  consent_version, liff_verified, group_member_verified, specified_user_matched,
                  bundle_sha256, signed_at, evidence_snapshot, evidence_sha256)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,true,true,$9,$10,$11::jsonb,$12)
               ON CONFLICT (signing_session_id) DO NOTHING`,
              [locked.rows[0].id, evidence.signerLineUserId, evidence.signerName,
                evidence.signatureDriveFileId, evidence.signatureHash, evidence.ipAddress,
                evidence.userAgent, evidence.consentVersion, locked.rows[0].bundle_sha256,
                evidence.signedAt, JSON.stringify(evidence), sha256(canonical(evidence))],
            );
          }
          const updated = await client.query(
            `UPDATE ${SCHEMA}.signing_sessions
                SET status = $2, state_snapshot = $3::jsonb, row_version = $4, updated_at = now()
              WHERE id = $1 AND row_version = $5`,
            [locked.rows[0].id, nextSession.status, JSON.stringify(nextSession),
              Number(expectedVersion) + 1, Number(expectedVersion)],
          );
          if (updated.rowCount === 1) {
            const aggregateState = ({ issued: 'issued', sent: 'sent', opened: 'opened', signed: 'signed',
              confirmed: 'signed', completed: 'completed', declined: 'declined', expired: 'expired', revoked: 'revoked' })[nextSession.status];
            if (aggregateState) {
              const latestEvent = (nextSession.events || []).at(-1) || {};
              await client.query(
                `UPDATE ${SCHEMA}.contracts c
                    SET current_version_id = v.id, workflow_state = $3, updated_by = $4,
                        updated_at = now(), row_version = c.row_version + 1
                   FROM ${SCHEMA}.contract_versions v
                  WHERE v.id = (SELECT version_id FROM ${SCHEMA}.signing_sessions WHERE id = $1)
                    AND c.id = v.contract_id AND c.tenant_key = $2`,
                [locked.rows[0].id, tenant.key, aggregateState,
                  String(latestEvent.actorId || context.actor || 'engineering-am-system')],
              );
              if (locked.rows[0].contract_id) {
                await insertOutboxRow(client, {
                  contractId: locked.rows[0].contract_id,
                  signingSessionId: locked.rows[0].id,
                  eventKind: 'notion_contract_projection',
                  idempotencyKey: `contract-projection:${externalSessionId}:${nextSession.status}:${Number(expectedVersion) + 1}`,
                  payload: { contractId: locked.rows[0].contract_id, externalSessionId, status: nextSession.status },
                });
              }
            }
          }
          return updated.rowCount === 1;
        });
        return result.value;
      },
    };
  }

  async function listContracts(tenant, projectIds = null) {
    const ids = Array.isArray(projectIds) ? projectIds.filter(Boolean) : null;
    const result = await withTenant(tenant, async (client) => client.query(
      `SELECT c.*,
              (SELECT max(v.version_no) FROM ${SCHEMA}.contract_versions v WHERE v.contract_id = c.id) AS latest_version,
              (SELECT s.status FROM ${SCHEMA}.signing_sessions s
                 JOIN ${SCHEMA}.contract_versions v ON v.id = s.version_id
                WHERE v.contract_id = c.id ORDER BY s.created_at DESC LIMIT 1) AS signing_status,
              (SELECT s.external_session_id FROM ${SCHEMA}.signing_sessions s
                 JOIN ${SCHEMA}.contract_versions v ON v.id = s.version_id
                WHERE v.contract_id = c.id ORDER BY s.created_at DESC LIMIT 1) AS signing_external_session_id
         FROM ${SCHEMA}.contracts c
        WHERE c.tenant_key = $1 AND ($2::text[] IS NULL OR c.project_notion_page_id = ANY($2::text[]))
        ORDER BY c.updated_at DESC`,
      [tenant.key, ids],
    ), { readOnly: true });
    return result.value.rows;
  }

  return {
    schema: SCHEMA,
    configured: (tenant) => configFor(env, tenant).configured,
    status,
    upsertContract,
    getContract,
    createVersion,
    listVersions,
    getVersion,
    transitionVersion,
    freezeVersion: freezeStoredVersion,
    issueVersion,
    enqueueOutbox,
    getOutboxByKey,
    claimOutbox,
    linkOutboxSession,
    completeOutbox,
    failOutbox,
    recordArtifact,
    getSigningBundle,
    listContracts,
    signingStorage,
    canonical,
    sha256,
  };
}

export const __test = { canonical, sha256, configFor, databaseTls, parseCertificateAuthority, productionRuntime, SCHEMA_VERSION };
