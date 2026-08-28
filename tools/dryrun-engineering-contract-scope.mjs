import assert from 'node:assert/strict';
import { handleContractsRequest } from '../modules/construction/contracts.js';

function request(body) {
  const payload = Buffer.from(JSON.stringify(body));
  return {
    method: 'POST',
    async *[Symbol.asyncIterator]() { yield payload; },
  };
}

function response() {
  return {
    status: 0,
    payload: null,
    writeHead(status) { this.status = status; },
    end(value) { this.payload = JSON.parse(value); },
  };
}

function notionPage(id, dataSourceId, projectId = '') {
  return {
    id,
    parent: { data_source_id: dataSourceId },
    properties: {
      '專案': { relation: projectId ? [{ id: projectId }] : [] },
      '編號': { title: [{ plain_text: 'HZ-CT-001' }] },
      '預算項目': { relation: [] },
    },
  };
}

const dataSources = {
  contracts: 'contracts-db',
  projects: 'projects-db',
  budgets: 'budgets-db',
  groupBindings: 'groups-db',
};

async function runEdit({ scope, contractProject = 'project-hz', groupProject = '', suppliedOperator = '偽造者' }) {
  const calls = [];
  const deps = {
    tenantKey: 'engineering',
    actor: 'Portal 真實帳號',
    dataSources,
    notionRequest: async (pathname, options = {}) => {
      calls.push({ pathname, options });
      if (pathname === '/v1/pages/contract-1' && options.method === 'GET') {
        return notionPage('contract-1', dataSources.contracts, contractProject);
      }
      if (pathname === `/v1/pages/${contractProject}` && options.method === 'GET') {
        return {
          id: contractProject,
          properties: { '館別代碼': { rich_text: [{ plain_text: contractProject === 'project-zs' ? 'ZS' : 'HZ' }] } },
        };
      }
      if (pathname === '/v1/pages/group-1' && options.method === 'GET') {
        return notionPage('group-1', dataSources.groupBindings, groupProject);
      }
      if (pathname === '/v1/pages/contract-1' && options.method === 'PATCH') return {};
      if (pathname === '/v1/blocks/contract-1/children' && options.method === 'PATCH') return {};
      throw new Error(`unexpected Notion call ${options.method} ${pathname}`);
    },
  };
  const res = response();
  const url = new URL(`https://example.test/contracts/api/edit?contract=1&contractManage=1&scope=${scope}`);
  await handleContractsRequest(
    request({ page: 'contract-1', name: '更新名稱', group: groupProject ? 'group-1' : undefined, operator: suppliedOperator }),
    res,
    '/contracts/api/edit',
    url,
    deps,
  );
  return { res, calls };
}

const denied = await runEdit({ scope: 'ZS', contractProject: 'project-hz' });
assert.equal(denied.res.status, 403);
assert.match(denied.res.payload.error, /無此專案/);
assert.equal(denied.calls.some((call) => call.pathname === '/v1/pages/contract-1' && call.options.method === 'PATCH'), false,
  'out-of-scope contract must never be patched');

const crossProjectGroup = await runEdit({ scope: 'ZS', contractProject: 'project-zs', groupProject: 'project-hz' });
assert.equal(crossProjectGroup.res.status, 500);
assert.match(crossProjectGroup.res.payload.error, /負責群組不屬於/);
assert.equal(crossProjectGroup.calls.some((call) => call.pathname === '/v1/pages/contract-1' && call.options.method === 'PATCH'), false,
  'cross-project group relation must never be written');

const allowed = await runEdit({ scope: 'ZS', contractProject: 'project-zs' });
assert.equal(allowed.res.status, 200);
const auditWrite = allowed.calls.find((call) => call.pathname === '/v1/blocks/contract-1/children');
const auditText = auditWrite.options.body.children[0].paragraph.rich_text[0].text.content;
assert.match(auditText, /Portal 真實帳號/);
assert.doesNotMatch(auditText, /偽造者/);

console.log('Engineering contract scope dry-run passed: scoped writes, relation isolation, and trusted actor are enforced.');
