// Create the tenant-local Notion index used by the construction design drawing library.
// Usage: node --env-file=.env tools/provision-design-drawings.mjs <tenant-key>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tenantKey = process.argv[2];
if (!tenantKey) throw new Error('Usage: node --env-file=.env tools/provision-design-drawings.mjs <tenant-key>');

const tenantPath = path.join(root, 'tenants', `${tenantKey}.json`);
if (!fs.existsSync(tenantPath)) throw new Error(`Unknown tenant: ${tenantKey}`);
const tenant = JSON.parse(fs.readFileSync(tenantPath, 'utf8'));
const prefix = tenant.envPrefix;
const parentPageId = String(process.env[`${prefix}_NOTION_PARENT_PAGE_ID`] || '').replace(/-/g, '');
const projectsDataSourceId = String(process.env[`${prefix}_PROJECTS_DATA_SOURCE_ID`] || '');
const existingDataSourceId = String(process.env[`${prefix}_DESIGN_DRAWINGS_DATA_SOURCE_ID`] || '');
const notionToken = process.env.NOTION_TOKEN || '';
const notionVersion = process.env.NOTION_VERSION || '2025-09-03';

if (existingDataSourceId) {
  console.log(JSON.stringify({ ok: true, skipped: true, tenant: tenantKey, dataSourceId: existingDataSourceId }, null, 2));
  process.exit(0);
}
if (!parentPageId) throw new Error(`${prefix}_NOTION_PARENT_PAGE_ID is required`);
if (!projectsDataSourceId) throw new Error(`${prefix}_PROJECTS_DATA_SOURCE_ID is required`);
if (!notionToken) throw new Error('NOTION_TOKEN is required');

async function notion(pathname, { method = 'GET', body } = {}) {
  const response = await fetch(`https://api.notion.com${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${notionToken}`, 'Notion-Version': notionVersion, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Notion ${method} ${pathname} ${response.status}: ${result.message || JSON.stringify(result)}`);
  return result;
}

await notion(`/v1/pages/${encodeURIComponent(parentPageId)}`);
await notion(`/v1/data_sources/${encodeURIComponent(projectsDataSourceId)}`);
const text = { rich_text: {} };
const created = await notion('/v1/databases', {
  method: 'POST',
  body: {
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: '設計圖版本' } }],
    initial_data_source: { properties: {
      '圖面': { title: {} },
      '專案': { relation: { data_source_id: projectsDataSourceId, single_property: {} } },
      '版本': text,
      '狀態': { select: { options: ['草稿', '送審', '定版', '發包版', '變更版', '作廢'].map((name) => ({ name })) } },
      '原始檔名': text,
      'Drive 檔案 ID': text,
      'Drive 連結': { url: {} },
      '檔案類型': text,
      '檔案大小': { number: {} },
      '版本說明': text,
      '上傳者': text,
      '上傳時間': { date: {} },
    } },
  },
});
const dataSourceId = created.data_sources?.[0]?.id;
if (!dataSourceId) throw new Error('Notion created the database but returned no data source ID');
console.log(JSON.stringify({
  ok: true,
  tenant: tenantKey,
  dataSourceId,
  env: `${prefix}_DESIGN_DRAWINGS_DATA_SOURCE_ID=${dataSourceId}`,
  next: 'Add the env line to the deployment secret settings, then restart the tenant runtime.',
}, null, 2));
