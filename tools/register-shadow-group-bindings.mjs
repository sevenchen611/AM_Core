// Register known LINE groups as tenant-local shadow bindings.
// It never stores group IDs in the repository: callers supply them at runtime.
// Usage:
// node --env-file=.env tools/register-shadow-group-bindings.mjs green-hotel --group-ids=<id,id,...> [--dry-run]

import { loadTenants, buildDataSourceRegistry } from '../core/tenants.js';
import { createNotion } from '../core/notion.js';

if (!process.env.NOTION_TOKEN && typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile('.env'); } catch {}
}

const [tenantKey] = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const groupIdsArg = process.argv.find((arg) => arg.startsWith('--group-ids='))?.slice('--group-ids='.length) || '';
const dryRun = process.argv.includes('--dry-run');
const groupIds = [...new Set(groupIdsArg.split(',').map((id) => id.trim()).filter(Boolean))];

if (!tenantKey || !groupIds.length) {
  console.error('Usage: node --env-file=.env tools/register-shadow-group-bindings.mjs <tenant-key> --group-ids=<id,id,...> [--dry-run]');
  process.exit(1);
}
if (groupIds.some((id) => !/^C[0-9a-f]{32}$/i.test(id))) {
  console.error('Every LINE group id must be a C followed by 32 hexadecimal characters.');
  process.exit(1);
}

const logger = { log: () => {}, warn: (message) => console.warn(message) };
const tenants = loadTenants(process.env, logger);
const tenant = tenants.find((item) => item.key === tenantKey);
if (!tenant?.dataSources?.groupBindings) throw new Error(`Tenant "${tenantKey}" has no groupBindings data source.`);
if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is required.');

const notion = createNotion({
  token: process.env.NOTION_TOKEN,
  version: process.env.NOTION_VERSION || '2025-09-03',
  registry: buildDataSourceRegistry(tenants, logger),
  logger,
});
const text = (content) => [{ type: 'text', text: { content: String(content).slice(0, 1900) } }];

async function groupName(groupId) {
  try {
    const response = await fetch(`https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/summary`, {
      headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
    return String(body.groupName || '').trim() || `待命名群組 ${groupId.slice(-6)}`;
  } catch (error) {
    console.warn(`Cannot resolve group name for ${groupId.slice(0, 7)}…: ${error.message}`);
    return `待命名群組 ${groupId.slice(-6)}`;
  }
}

async function existingBinding(groupId) {
  const result = await notion.notionRequest(`/v1/data_sources/${encodeURIComponent(tenant.dataSources.groupBindings)}/query`, {
    method: 'POST', tenantKey: tenant.key,
    body: { filter: { property: 'LINE 群組 ID', rich_text: { equals: groupId } }, page_size: 1 },
  });
  return result.results?.[0] || null;
}

const created = [];
const updated = [];
for (const groupId of groupIds) {
  const [name, existing] = await Promise.all([groupName(groupId), existingBinding(groupId)]);
  const properties = {
    '群組名稱': { title: text(name) },
    'LINE 群組 ID': { rich_text: text(groupId) },
    '狀態': { select: { name: '影子記錄' } },
    '群組用途': { rich_text: text('Green Hotel AM 知識、圖片與會議影子收集（待分類）') },
    '啟用功能': { multi_select: [{ name: '訊息收集' }, { name: '會議' }, { name: '照片' }] },
    '所屬目標': { rich_text: text('Green Hotel AM 知識與會議影子收集') },
    '狀態更新權限': { select: { name: '所有成員' } },
    '最後設定時間': { date: { start: new Date().toISOString() } },
    '最後設定者': { rich_text: text('Green Hotel AM shadow onboarding') },
  };
  if (dryRun) {
    (existing ? updated : created).push({ groupId, name });
    continue;
  }
  if (existing) {
    await notion.notionRequest(`/v1/pages/${encodeURIComponent(existing.id)}`, {
      method: 'PATCH', tenantKey: tenant.key,
      // Existing business metadata is preserved; only the onboarding controls are changed.
      body: { properties: {
        '狀態': properties['狀態'],
        '啟用功能': properties['啟用功能'],
        '最後設定時間': properties['最後設定時間'],
        '最後設定者': properties['最後設定者'],
      } },
    });
    updated.push({ groupId, name });
  } else {
    await notion.notionRequest('/v1/pages', {
      method: 'POST', tenantKey: tenant.key,
      body: { parent: { type: 'data_source_id', data_source_id: tenant.dataSources.groupBindings }, properties },
    });
    created.push({ groupId, name });
  }
}

console.log(JSON.stringify({ tenant: tenant.key, dryRun, requested: groupIds.length, created: created.length, updated: updated.length, groups: [...created, ...updated].map(({ name }) => name) }, null, 2));
