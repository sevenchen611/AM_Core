// Run in the authorized deployment checkout. Default: plan only. Persist IDs OUTSIDE AMCore.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTenants, buildDataSourceRegistry } from '../core/tenants.js';
import { createNotion } from '../core/notion.js';
import { journalSchemas } from '../versions/AM-IMP-2026.1005.01/schemas/journal-schema.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), tenantKey = args[0], apply = args.includes('--apply');
if (!/^[a-z0-9_-]+$/.test(tenantKey || '')) throw new Error('Usage: node --env-file=<deployment-env> tools/provision-construction-journal.mjs <tenant> [--apply --state <project-local-path>]');
const tenants = loadTenants(), tenant = tenants.find(t => t.key === tenantKey);
if (!tenant || !tenant.modules.includes('construction')) throw new Error('Tenant must have construction enabled');
if (!apply) {
  console.log(JSON.stringify({ tenant: tenantKey, mode: 'plan', creates: ['工程日誌', '工程日誌現場照片', '工程施工進度紀錄'], requires: ['projects', 'spaces', 'workItems', 'budgets', 'contracts', 'attachments'], existingBindingKeys: Object.keys(tenant.dataSources), writes: false }, null, 2));
  process.exit(0);
}
const stateArg = args[args.indexOf('--state') + 1];
if (!args.includes('--state') || !stateArg || !path.isAbsolute(stateArg)) throw new Error('--state requires an absolute project-local path outside AMCore');
const statePath = path.resolve(stateArg);
const relative = path.relative(root, statePath);
if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw new Error('Do not store tenant binding IDs inside AMCore');
if (!tenant.parentPageId || !process.env.NOTION_TOKEN) throw new Error('Tenant-local parent and Notion credentials are required');
const notion = createNotion({ token: process.env.NOTION_TOKEN, version: process.env.NOTION_VERSION || '2025-09-03', registry: buildDataSourceRegistry(tenants) });
const request = (p, o = {}) => notion.notionRequest(p, { ...o, tenantKey });
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { tenant: tenantKey, bindings: {}, pending: null };
if (state.tenant !== tenantKey || !state.bindings) throw new Error('State belongs to another tenant or has invalid format');
if (state.pending) throw new Error('Earlier create outcome is unknown. Recover its data-source ID in Notion, add it to state.bindings, clear pending, then retry. Never create a duplicate blindly.');
const ids = { ...tenant.dataSources, ...state.bindings };
for (const key of ['projects', 'spaces', 'workItems', 'budgets', 'contracts', 'attachments']) {
  if (!ids[key] || ids[key] !== tenant.dataSources[key]) throw new Error(`Missing or mismatched ${key} binding`);
  await request(`/v1/data_sources/${encodeURIComponent(ids[key])}`, { method: 'GET' });
}
function save() {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath + '.tmp', JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(statePath + '.tmp', statePath);
}
for (const key of ['constructionJournals', 'constructionPhotos', 'constructionProgress']) {
  const schema = journalSchemas(ids)[key];
  if (ids[key]) {
    await notion.registerTenantDataSource(tenant, ids[key], key);
    const existing = await request(`/v1/data_sources/${encodeURIComponent(ids[key])}`, { method: 'GET' });
    for (const [name, expected] of Object.entries(schema.properties)) {
      const actual = existing.properties?.[name];
      const type = Object.keys(expected || {})[0];
      if (!actual || actual.type !== type) throw new Error(`Existing ${key} schema differs: ${name}`);
      if (type === 'relation' && actual.relation?.data_source_id?.replace(/-/g, '') !== expected.relation.data_source_id.replace(/-/g, '')) throw new Error(`Existing ${key} relation differs: ${name}`);
      if (type === 'relation' && actual.relation?.type !== expected.relation.type) throw new Error(`Existing ${key} relation direction differs: ${name}`);
    }
    continue;
  }
  if (Object.values(schema.properties).some(p => !p)) throw new Error('Incomplete relation bindings');
  state.pending = key; save();
  const created = await request('/v1/databases', { method: 'POST', body: {
    parent: { type: 'page_id', page_id: tenant.parentPageId }, title: [{ type: 'text', text: { content: schema.name } }],
    initial_data_source: { properties: schema.properties },
  } });
  const id = created.data_sources?.[0]?.id;
  if (!id) throw new Error('Create outcome unknown; recover ID before retrying');
  state.bindings[key] = id; state.pending = null; save(); ids[key] = id;
  await notion.registerTenantDataSource(tenant, id, key);
}
console.log(JSON.stringify({ ok: true, tenant: tenantKey, stateSavedOutsideAMCore: true, next: 'Use state bindings to configure <PREFIX>_CONSTRUCTION_JOURNALS_DATA_SOURCE_ID, <PREFIX>_CONSTRUCTION_PHOTOS_DATA_SOURCE_ID, <PREFIX>_CONSTRUCTION_PROGRESS_DATA_SOURCE_ID in deployment secrets. Restart and verify Portal access before Installed/Deployed.' }, null, 2));
