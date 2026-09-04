
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createContractStore } from '../core/contract-store.js';
import { createContractAcceptanceService } from '../modules/construction/contract-acceptance.js';

const tenant = { key: 'engineering', envPrefix: 'ENG' };
const contractId = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
const eventId = '33333333-3333-4333-8333-333333333333';
const evidenceHash = createHash('sha256').update('demolition-acceptance-photo').digest('hex');

const storedEvents = [];
const observed = [];
const contextRow = {
  contractId,
  projectId: 'engineering-project-demolition',
  projectCode: 'AM-ENG',
  notionContractPageId: 'notion-contract-demolition',
  contractNumber: 'AM-DEM-001',
  title: '拆除工程合約',
  trade: '拆除',
  counterpartyName: '乙方承攬商',
  amount: '120000',
  currency: 'TWD',
  versionId,
  versionContractId: contractId,
  versionNo: 1,
  versionStatus: 'frozen',
  contractSnapshot: {
    documentPackage: {
      acceptanceCriteria: [{
        id: 'demolition-cleanup',
        criterion: '拆除面清潔',
        evidenceRequired: '現場照片',
      }],
    },
  },
  bundleManifest: [],
  bundleSha256: 'a'.repeat(64),
  frozenAt: '2026-09-03T01:00:00.000Z',
  issuedAt: null,
};

const fakeClient = {
  async query(sql, params = []) {
    const statement = String(sql);
    observed.push({ statement, params });
    if (/^(BEGIN|COMMIT|ROLLBACK|SET TRANSACTION|SELECT set_config)/.test(statement.trim())) {
      return { rows: [], rowCount: 0 };
    }
    if (statement.includes('FROM engineering_contracts.contracts c') && statement.includes('LIMIT 1')) {
      const belongsToTenant = params[0] === tenant.key && params[1] === contractId && params[2] === versionId;
      return { rows: belongsToTenant ? [contextRow] : [], rowCount: belongsToTenant ? 1 : 0 };
    }
    if (statement.includes('FROM engineering_contracts.contract_acceptance_events') && statement.includes('ORDER BY sequence_no ASC')) {
      return { rows: storedEvents.map((event) => ({ ...event })), rowCount: storedEvents.length };
    }
    if (statement.includes('FROM engineering_contracts.contract_versions v') && statement.includes('FOR UPDATE OF v')) {
      const belongsToTenant = params[0] === tenant.key && params[1] === contractId && params[2] === versionId;
      return { rows: belongsToTenant ? [{ contract_id: contractId, version_id: versionId, status: 'frozen' }] : [], rowCount: belongsToTenant ? 1 : 0 };
    }
    if (statement.includes('FROM engineering_contracts.contract_acceptance_events') && statement.includes('ORDER BY sequence_no DESC')) {
      const previous = storedEvents.at(-1);
      return {
        rows: previous ? [{ sequence_no: previous.sequenceNo, event_hash: previous.eventHash }] : [],
        rowCount: previous ? 1 : 0,
      };
    }
    if (statement.includes('INSERT INTO engineering_contracts.contract_acceptance_events')) {
      const event = {
        id: params[0], contractId: params[1], versionId: params[2], itemId: params[3],
        sequenceNo: params[4], type: params[5], previousEventHash: params[6], eventHash: params[7],
        actor: params[8], occurredAt: params[9], payload: JSON.parse(params[10]),
      };
      storedEvents.push(event);
      return { rows: [event], rowCount: 1 };
    }
    throw new Error('Unexpected SQL in acceptance store dry-run: ' + statement);
  },
  release() {},
};

const store = createContractStore({
  env: { ENG_CONTRACTS_DATABASE_URL: 'postgres://acceptance-test', ENG_CONTRACTS_DATABASE_SSL: '0' },
  poolFactory: () => ({ connect: async () => fakeClient }),
  logger: { warn() {} },
});

const service = createContractAcceptanceService({
  repository: store,
  clock: () => new Date('2026-09-03T02:00:00.000Z'),
  idFactory: () => eventId,
});

const authority = {
  tenant,
  actor: 'engineering.acceptance@example.test',
  actorRoles: ['engineering_acceptance_submitter'],
  scope: { projectIds: [contextRow.projectId] },
};

const submitted = await service.submit(authority, {
  contractId,
  versionId,
  itemId: 'demolition-cleanup',
  evidence: [{ reference: 'private-drive-photo-001', sha256: evidenceHash, kind: 'photo' }],
  note: '拆除完成，送驗收。',
});

assert.equal(submitted.workflow.status, 'awaiting_review');
assert.equal(storedEvents.length, 1);
assert.equal(storedEvents[0].sequenceNo, 1);
assert.equal(storedEvents[0].previousEventHash, '');
assert.ok(/^[a-f0-9]{64}$/.test(storedEvents[0].eventHash));

await assert.rejects(
  store.appendAcceptanceEvent(tenant, {
    ...storedEvents[0],
    id: '44444444-4444-4444-8444-444444444444',
    expectedSequenceNo: 1,
    expectedPreviousEventHash: '',
  }),
  (error) => error.code === 'ACCEPTANCE_EVENT_CAS_FAILED' && error.statusCode === 409,
);

assert.equal(
  await store.getAcceptanceContext(tenant, { contractId: '99999999-9999-4999-8999-999999999999', versionId }),
  null,
  'context lookup must not cross the tenant-scoped contract boundary',
);

assert.ok(observed.some((entry) => entry.statement.includes("set_config('app.tenant_key'")),
  'every acceptance operation must set the tenant context inside its transaction');
assert.ok(observed.some((entry) => entry.statement.includes('SET TRANSACTION READ ONLY')),
  'acceptance context reads must be read-only transactions');
assert.ok(observed.some((entry) => entry.statement.includes('FOR UPDATE OF v')),
  'append must lock the version to serialize an empty acceptance chain');

console.log('Engineering acceptance PostgreSQL adapter dry-run passed: tenant-scoped context, immutable event projection, and sequence/hash CAS verified.');
