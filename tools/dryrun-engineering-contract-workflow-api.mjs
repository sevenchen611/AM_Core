import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { createContractWorkflowApiHandler } from '../modules/construction/contract-workflow-api.js';
import { __test as workflowApiTest } from '../modules/construction/contract-workflow-api.js';

const NOW = '2026-08-28T01:30:00.000Z';

function completePackage() {
  return {
    contractBody: { name: '工程合約本文.pdf', fileId: 'body-1', sha256: 'a'.repeat(64) },
    constructionDrawings: [{ name: '施工圖 A1.pdf', fileId: 'drawing-1', sha256: 'b'.repeat(64) }],
    quotation: { name: '核定報價單.pdf', fileId: 'quote-1', sha256: 'c'.repeat(64) },
    paymentMilestones: [
      { id: 'deposit', label: '簽約款', percentage: 50, amount: 50_000, dueDate: '2026-09-01', dueTime: '17:00' },
      { id: 'balance', label: '驗收尾款', percentage: 50, amount: 50_000, trigger: '驗收後七日內' },
    ],
    acceptanceCriteria: [{ id: 'finish', criterion: '完成面誤差不得超過 3 mm', evidenceRequired: '現場量測照片' }],
  };
}

function memoryStore() {
  const contracts = new Map();
  const versions = new Map();
  const calls = [];
  return {
    calls,
    async upsertContract(tenant, input) {
      calls.push(['upsertContract', tenant.key, structuredClone(input)]);
      const existing = [...contracts.values()].find((item) => item.notionContractPageId === input.notionContractPageId);
      const value = { ...(existing || {}), ...structuredClone(input), id: existing?.id || `contract-${contracts.size + 1}` };
      contracts.set(value.id, value);
      return structuredClone(value);
    },
    async getContract(tenant, selector) {
      calls.push(['getContract', tenant.key, structuredClone(selector)]);
      const value = selector.contractId
        ? contracts.get(selector.contractId)
        : [...contracts.values()].find((item) => item.notionContractPageId === selector.notionContractPageId);
      return value ? structuredClone(value) : null;
    },
    async listContracts(tenant, projectIds) {
      calls.push(['listContracts', tenant.key, structuredClone(projectIds)]);
      const values = [...contracts.values()];
      return structuredClone(projectIds ? values.filter((item) => projectIds.includes(item.projectId)) : values);
    },
    async listVersions(tenant, contractId) {
      calls.push(['listVersions', tenant.key, contractId]);
      return structuredClone([...versions.values()].filter((item) => item.contractId === contractId));
    },
    async getVersion(tenant, versionId) {
      calls.push(['getVersion', tenant.key, versionId]);
      return versions.has(versionId) ? structuredClone(versions.get(versionId)) : null;
    },
    async createVersion(tenant, input) {
      calls.push(['createVersion', tenant.key, structuredClone(input)]);
      const value = {
        ...structuredClone(input),
        id: `version-${versions.size + 1}`,
        createdBy: input.actor,
      };
      versions.set(value.id, value);
      return structuredClone(value);
    },
    async transitionVersion(tenant, input) {
      calls.push(['transitionVersion', tenant.key, structuredClone(input)]);
      const current = versions.get(input.versionId);
      if (!current || current.contractId !== input.contractId || current.status !== input.expectedStatus) return null;
      const evidence = input.transitionTimeField && input.transitionActorField ? {
        [input.transitionTimeField]: input.transitionedAt,
        [input.transitionActorField]: input.transitionedBy,
      } : {};
      const value = { ...current, status: input.nextStatus, ...evidence };
      versions.set(value.id, value);
      return structuredClone(value);
    },
    async freezeVersion(tenant, input) {
      calls.push(['freezeVersion', tenant.key, structuredClone(input)]);
      const current = versions.get(input.versionId);
      if (!current || current.contractId !== input.contractId || current.status !== input.expectedStatus) return null;
      const value = {
        ...current,
        status: 'frozen',
        frozenAt: input.frozenAt,
        frozenBy: input.frozenBy,
        manifest: structuredClone(input.manifest),
        attachmentManifestHash: input.attachmentManifestHash,
      };
      versions.set(value.id, value);
      return structuredClone(value);
    },
  };
}

function request(method, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  return req;
}

function response() {
  return {
    statusCode: null,
    headers: {},
    body: '',
    writeHead(statusCode, headers) { this.statusCode = statusCode; Object.assign(this.headers, headers); },
    setHeader(name, value) { this.headers[name] = value; },
    end(body = '') { this.body += body; },
    json() { return JSON.parse(this.body); },
  };
}

async function call(handler, method, pathname, { body, authority, query = '' } = {}) {
  const res = response();
  const url = new URL(`https://am.example${pathname}${query}`);
  const handled = await handler(request(method, body), res, pathname, url, authority);
  return { handled, res, payload: res.body ? res.json() : null };
}

const store = memoryStore();
const handler = createContractWorkflowApiHandler({
  tenant: { key: 'engineering' },
  actor: 'portal:user-7',
  contractStore: store,
  contractClock: () => new Date(NOW),
});
const scope = { projectIds: ['project-1'], projectCodes: ['P1'] };
const view = { scope, capabilities: { view: true } };
const manage = { scope, capabilities: { manage: true } };
const issue = { scope, capabilities: { issue: true } };

{
  const result = await call(handler, 'GET', '/other');
  assert.equal(result.handled, false);
  assert.equal(result.res.statusCode, null);
}

{
  const result = await call(handler, 'GET', '/contracts/api/v2/contracts', {
    authority: { scope, capabilities: {} },
  });
  assert.equal(result.res.statusCode, 403);
  assert.equal(result.payload.error.code, 'CONTRACT_CAPABILITY_REQUIRED');
}

{
  const result = await call(handler, 'POST', '/contracts/api/v2/contracts/sync', {
    authority: { scope, capabilities: {} },
    body: {
      projectId: 'project-1', notionContractPageId: 'notion-1', title: '水電工程合約',
      actor: 'attacker', scope: 'all', capabilities: { manage: true },
    },
  });
  assert.equal(result.res.statusCode, 403, 'body capabilities must not grant access');
  assert.equal(store.calls.some(([name]) => name === 'upsertContract'), false);
}

{
  const result = await call(handler, 'POST', '/contracts/api/v2/contracts/sync', {
    authority: manage,
    body: {
      projectId: 'project-2', projectCode: 'P2', notionContractPageId: 'notion-2',
      title: '越權合約', actor: 'attacker', scope: 'all',
    },
  });
  assert.equal(result.res.statusCode, 404);
  assert.equal(result.payload.error.code, 'PROJECT_SCOPE_DENIED');
}

let contractId;
{
  const result = await call(handler, 'POST', '/contracts/api/v2/contracts/sync', {
    authority: manage,
    body: {
      projectId: 'project-1', projectCode: 'P1', notionContractPageId: 'notion-1',
      title: '水電工程合約', amount: 100_000, actor: 'attacker', operator: 'attacker',
      tenant: { key: 'evil' }, scope: 'all', authorization: { projectIds: ['project-2'] },
    },
  });
  assert.equal(result.res.statusCode, 200);
  contractId = result.payload.data.contract.id;
  assert.equal(result.payload.data.synchronizedBy, 'portal:user-7');
  const write = store.calls.find(([name]) => name === 'upsertContract');
  assert.equal(write[1], 'engineering');
  assert.equal(write[2].actor, 'portal:user-7');
  assert.equal('scope' in write[2], false);
}

{
  const result = await call(handler, 'GET', '/contracts/api/v2/contracts', {
    authority: view,
    query: '?projectId=project-1&projectCode=P1',
  });
  assert.equal(result.res.statusCode, 200);
  assert.equal(result.payload.data.count, 1);
  assert.equal(result.res.headers['Cache-Control'], 'no-store');
}

{
  const result = await call(handler, 'GET', `/contracts/api/v2/contracts/${contractId}`, { authority: view });
  assert.equal(result.res.statusCode, 200);
  assert.equal(result.payload.data.contract.id, contractId);
}

{
  const result = await call(handler, 'POST', `/contracts/api/v2/contracts/${contractId}/versions`, {
    authority: manage,
    body: { contractId: 'different-contract', documentPackage: completePackage() },
  });
  assert.equal(result.res.statusCode, 400);
  assert.equal(result.payload.error.code, 'PATH_BODY_REFERENCE_MISMATCH');
}

let versionId;
{
  const result = await call(handler, 'POST', `/contracts/api/v2/contracts/${contractId}/versions`, {
    authority: manage,
    body: { documentPackage: completePackage(), actor: 'attacker', scope: 'all' },
  });
  assert.equal(result.res.statusCode, 200);
  versionId = result.payload.data.version.id;
  assert.equal(result.payload.data.createdBy, 'portal:user-7');
}

{
  const result = await call(handler, 'POST', `/contracts/api/v2/contracts/${contractId}/versions/${versionId}/submit-review`, {
    authority: manage,
    body: { actor: 'attacker', status: undefined },
  });
  assert.equal(result.res.statusCode, 200);
  assert.equal(result.payload.data.version.status, 'internal_review');
}

{
  const returned = await call(handler, 'POST', `/contracts/api/v2/contracts/${contractId}/versions/${versionId}/return-draft`, {
    authority: manage,
    body: {},
  });
  assert.equal(returned.res.statusCode, 200);
  assert.equal(returned.payload.data.version.status, 'draft');

  const resubmitted = await call(handler, 'POST', `/contracts/api/v2/contracts/${contractId}/versions/${versionId}/submit-review`, {
    authority: manage,
    body: {},
  });
  assert.equal(resubmitted.res.statusCode, 200);
  assert.equal(resubmitted.payload.data.version.status, 'internal_review');
}

{
  const denied = await call(handler, 'POST', `/contracts/api/v2/contracts/${contractId}/versions/${versionId}/approve`, {
    authority: manage,
    body: {},
  });
  assert.equal(denied.res.statusCode, 403);
  assert.equal(denied.payload.error.details.capability, 'issue');

  const approved = await call(handler, 'POST', `/contracts/api/v2/contracts/${contractId}/versions/${versionId}/approve`, {
    authority: issue,
    body: {},
  });
  assert.equal(approved.res.statusCode, 200);
  assert.equal(approved.payload.data.version.status, 'approved');
}

{
  const result = await call(handler, 'POST', `/contracts/api/v2/contracts/${contractId}/versions/${versionId}/freeze`, {
    authority: issue,
    body: {},
  });
  assert.equal(result.res.statusCode, 200);
  assert.equal(result.payload.data.version.status, 'frozen');
  assert.match(result.payload.data.version.attachmentManifestHash, /^[a-f0-9]{64}$/);
}

{
  const result = await call(handler, 'GET', `/contracts/api/v2/contracts/${contractId}/versions/${versionId}/readiness`, {
    authority: view,
  });
  assert.equal(result.res.statusCode, 200);
  assert.equal(result.payload.data.ready, true);
  assert.equal(result.payload.data.checkedBy, 'portal:user-7');
}

{
  const result = await call(handler, 'PUT', `/contracts/api/v2/contracts/${contractId}/versions/${versionId}/freeze`, {
    authority: issue,
  });
  assert.equal(result.res.statusCode, 405);
  assert.equal(result.res.headers.Allow, 'POST');
}

{
  for (let attachmentId = 0; attachmentId < 6; attachmentId += 1) {
    const input = {};
    workflowApiTest.bindPathReference(input, 'contractId', contractId);
    workflowApiTest.bindPathReference(input, 'versionId', versionId);
    workflowApiTest.bindPathReference(input, 'attachmentId', String(attachmentId));
    assert.deepEqual(input, { contractId, versionId, attachmentId: String(attachmentId) });
  }
  const input = { contractId, versionId };
  workflowApiTest.bindPathReference(input, 'archiveId', 'archive-1');
  assert.equal(input.versionId, versionId, 'archive binding must not compare against or erase versionId');
  assert.equal(input.archiveId, 'archive-1');
}

{
  const denied = await call(handler, 'POST', '/contracts/api/v2/signing-sessions/cs_example1234567890/confirm-complete', {
    authority: view, body: {},
  });
  assert.equal(denied.res.statusCode, 403);
  assert.equal(denied.payload.error.details.capability, 'confirm');
}

console.log('Engineering contract workflow API dry-run passed: v2 routes, server actor/scope, and view/manage/issue/confirm gates are enforced.');
