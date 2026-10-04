// Additive schema provisioning and read-only gap audit. Output is aggregate-only by default.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ATTACHMENT_ARCHIVE_PROPERTIES } from '../core/attachment-archive.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, fallback = '') => args.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const tenantKey = arg('tenant', 'hozo-am-2-0');
const tenant = JSON.parse(fs.readFileSync(path.join(root, 'tenants', `${tenantKey}.json`), 'utf8'));
const ds = process.env[`${tenant.envPrefix}_ATTACHMENTS_DATA_SOURCE_ID`];
const parent = process.env[`${tenant.envPrefix}_NOTION_PARENT_PAGE_ID`];
if (!ds || !parent || !process.env.NOTION_TOKEN) throw new Error('Tenant attachments data source, parent and Notion credentials are required.');
const normalize = id => String(id || '').replace(/-/g, '').toLowerCase();
async function notion(p, method = 'GET', body) {
  const response = await fetch(`https://api.notion.com${p}`, { method,
    headers: { Authorization: `Bearer ${process.env.NOTION_TOKEN}`, 'Notion-Version': process.env.NOTION_VERSION || '2025-09-03', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Notion request failed: HTTP ${response.status}`);
  return response.json();
}
const schema = await notion(`/v1/data_sources/${encodeURIComponent(ds)}`);
if (normalize(schema.database_parent?.page_id) !== normalize(parent)) throw new Error('Tenant data source parent mismatch; refusing access.');
const wrongTypes = Object.entries(ATTACHMENT_ARCHIVE_PROPERTIES).filter(([name, definition]) => schema.properties?.[name] && schema.properties[name].type !== Object.keys(definition)[0]);
if (wrongTypes.length) throw new Error(`Existing field types conflict: ${wrongTypes.map(([name]) => name).join(', ')}`);
const missing = Object.fromEntries(Object.entries(ATTACHMENT_ARCHIVE_PROPERTIES).filter(([name]) => !schema.properties?.[name]));
if (args.includes('--apply') && Object.keys(missing).length) await notion(`/v1/data_sources/${encodeURIComponent(ds)}`, 'PATCH', { properties: missing });
const report = { tenant: tenantKey, applied: args.includes('--apply'), missingFields: Object.keys(missing) };
if (args.includes('--audit')) {
  const counts = { total: 0, withDrive: 0, withNotionFile: 0, missingOriginal: 0, largeMissingOriginal: 0, states: {} };
  let cursor;
  do {
    const body = { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) };
    const since = arg('since');
    if (since) body.filter = { property: '日期', date: { on_or_after: since } };
    const page = await notion(`/v1/data_sources/${encodeURIComponent(ds)}/query`, 'POST', body);
    for (const row of page.results || []) {
      const p = row.properties;
      counts.total++;
      if (p['Drive 連結']?.url) counts.withDrive++;
      if (p['檔案']?.files?.length) counts.withNotionFile++;
      if (!p['Drive 連結']?.url && !p['檔案']?.files?.length) {
        counts.missingOriginal++;
        if (Number(p['檔案大小']?.number) > 20 * 1024 * 1024) counts.largeMissingOriginal++;
      }
      const status = p['保存狀態']?.select?.name || '歷史未標示';
      counts.states[status] = (counts.states[status] || 0) + 1;
    }
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  report.audit = counts;
}
console.log(JSON.stringify(report, null, 2));
