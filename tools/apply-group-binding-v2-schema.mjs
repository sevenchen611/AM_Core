// 為指定租戶「自己的」群組綁定 data source 補上群組綁定 v2 欄位。
// 用法：node --env-file=.env tools/apply-group-binding-v2-schema.mjs forest [--dry-run]
// 不會複製資料、不會變更既有欄位型別；型別衝突時拒絕執行。

import { loadTenants, buildDataSourceRegistry } from '../core/tenants.js';
import { createNotion } from '../core/notion.js';
import { groupBindingV2SchemaPatch } from '../core/group-binding-schema.js';

if (!process.env.NOTION_TOKEN && typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile('.env'); } catch {}
}

const tenantKey = process.argv.find((arg) => !arg.startsWith('-') && arg !== process.argv[0] && arg !== process.argv[1]);
const dryRun = process.argv.includes('--dry-run');
if (!tenantKey) {
  console.error('Usage: node --env-file=.env tools/apply-group-binding-v2-schema.mjs <tenant-key> [--dry-run]');
  process.exit(1);
}

const logger = { log: () => {}, warn: (message) => console.warn(message) };
const tenants = loadTenants(process.env, logger);
const tenant = tenants.find((item) => item.key === tenantKey);
if (!tenant?.dataSources?.groupBindings) {
  console.error(`Tenant "${tenantKey}" has no configured groupBindings data source.`);
  process.exit(1);
}
const notion = createNotion({
  token: process.env.NOTION_TOKEN,
  version: process.env.NOTION_VERSION || '2025-09-03',
  registry: buildDataSourceRegistry(tenants, logger),
  logger,
});

const dataSourceId = tenant.dataSources.groupBindings;
const current = await notion.notionRequest(`/v1/data_sources/${encodeURIComponent(dataSourceId)}`, {
  method: 'GET', tenantKey: tenant.key,
});
let properties;
try {
  properties = groupBindingV2SchemaPatch(current.properties || {});
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const names = Object.keys(properties);
if (!names.length) {
  console.log(`群組綁定 v2 已就緒（tenant=${tenant.key}；無需變更）。`);
  process.exit(0);
}
console.log(`tenant=${tenant.key} 將補上／補齊：${names.join('、')}`);
if (dryRun) {
  console.log('dry-run：未寫入 Notion。');
  process.exit(0);
}
await notion.notionRequest(`/v1/data_sources/${encodeURIComponent(dataSourceId)}`, {
  method: 'PATCH', tenantKey: tenant.key, body: { properties },
});
const verified = await notion.notionRequest(`/v1/data_sources/${encodeURIComponent(dataSourceId)}`, {
  method: 'GET', tenantKey: tenant.key,
});
const missing = names.filter((name) => !verified.properties?.[name]);
if (missing.length) {
  console.error(`寫入後驗證失敗，仍缺少：${missing.join('、')}`);
  process.exit(1);
}
console.log(`群組綁定 v2 已完成（tenant=${tenant.key}；${names.length} 項）。`);
