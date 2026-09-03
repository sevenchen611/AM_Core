import assert from 'node:assert/strict';
import { handleContractsRequest } from '../modules/construction/contracts.js';

const tenant = { key: 'engineering-test' };
const rows = [{ id: '11111111-1111-4111-8111-111111111111', contract_number: 'DEM-001', title: '拆除工程', project_notion_page_id: 'project-demolition', current_version_id: '22222222-2222-4222-8222-222222222222', signing_external_session_id: 'session-1' }];
const store = {
  async status() { return { configured: true, schemaReady: true, schemaVersion: '2026-09-02.engineering-contract-evidence.v9', archiveSchemaReady: true }; },
  async listContracts() { return rows; },
  async getContract(_tenant, { contractId }) { return rows.find((row) => row.id === contractId) || null; },
  async getVersion() { return { id: rows[0].current_version_id, contract_id: rows[0].id, contract_snapshot: { documentPackage: { partyAProfileSnapshot: { profileType: 'company', assets: { large_seal: { fileId: 'private' } } } } } }; },
  async getSigningBundle() { return { session: { status: 'signed', submission: { receivedAt: '2026-09-03T01:00:00.000Z' } }, events: [{ event_type: 'signed', occurred_at: '2026-09-03T01:00:00.000Z' }] }; },
};
function response() {
  const result = { headers: {}, status: 0, body: '' };
  result.setHeader = (name, value) => { result.headers[name.toLowerCase()] = value; };
  result.writeHead = (status, headers = {}) => { result.status = status; Object.assign(result.headers, Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))); };
  result.end = (body = '') => { result.body = String(body); };
  return result;
}
const deps = {
  tenant, tenantKey: 'engineering-test', contractStore: store,
  async notionRequest() { return { results: [] }; },
  dataSources: { projects: 'projects' },
};
const url = new URL('https://example.test/contracts/api/v2/control-center?contract=1&scope=P01');
const res = response();
await handleContractsRequest({ method: 'GET' }, res, '/contracts/api/v2/control-center', url, deps);
assert.equal(res.status, 200);
assert.equal(res.headers['cache-control'], 'no-store');
assert.equal(JSON.parse(res.body).data.contracts.length, 0, 'scope must be resolved server-side before the control service reads contracts');
const unrestricted = response();
const unrestrictedUrl = new URL('https://example.test/contracts/api/v2/contracts/11111111-1111-4111-8111-111111111111/control?contract=1');
await handleContractsRequest({ method: 'GET' }, unrestricted, '/contracts/api/v2/contracts/11111111-1111-4111-8111-111111111111/control', unrestrictedUrl, deps);
assert.equal(unrestricted.status, 200);
assert.equal(JSON.parse(unrestricted.body).data.contract.partyA.label, '公司章已隨版本凍結');
console.log('dryrun-engineering-contract-control-routes: OK');
