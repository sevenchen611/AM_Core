import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const TASK_CONTROL_TASK_PROPERTIES = {
  '目前進度': { rich_text: {} },
  '下一步': { rich_text: {} },
  '阻礙': { rich_text: {} },
  '關鍵字': { multi_select: { options: [] } },
  '最近更新': { date: {} },
};

const args = new Set(process.argv.slice(2));
const tenantKey = [...args].find((arg) => arg.startsWith('--tenant='))?.slice('--tenant='.length) || 'hozo-am-2-0';
const dryRun = args.has('--dry-run') || !args.has('--apply');

function loadDotenv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

async function notion(pathname, options = {}) {
  const response = await fetch(`https://api.notion.com${pathname}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': process.env.NOTION_VERSION || '2025-09-03',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Notion API failed: ${response.status} ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : {};
}

function tenantConfig(key) {
  const file = path.resolve('tenants', `${key}.json`);
  if (!existsSync(file)) throw new Error(`Unknown tenant: ${key}`);
  const config = JSON.parse(readFileSync(file, 'utf8'));
  if (!config.envPrefix) throw new Error(`Tenant ${key} has no environment prefix.`);
  return config;
}

loadDotenv(path.resolve('.env'));
const tenant = tenantConfig(tenantKey);
const dataSourceId = process.env[`${tenant.envPrefix}_TASKS_DATA_SOURCE_ID`] || '';
if (!process.env.NOTION_TOKEN) throw new Error('NOTION_TOKEN is required in the target runtime environment.');
if (!dataSourceId) throw new Error(`${tenant.envPrefix}_TASKS_DATA_SOURCE_ID is required in the target runtime environment.`);

const schema = await notion(`/v1/data_sources/${encodeURIComponent(dataSourceId)}`);
const missing = Object.entries(TASK_CONTROL_TASK_PROPERTIES)
  .filter(([name]) => !schema.properties?.[name])
  .map(([name, definition]) => [name, definition]);

if (!dryRun && missing.length) {
  await notion(`/v1/data_sources/${encodeURIComponent(dataSourceId)}`, {
    method: 'PATCH',
    body: { properties: Object.fromEntries(missing) },
  });
}

console.log(JSON.stringify({
  ok: true,
  tenant: tenantKey,
  mode: dryRun ? 'dry-run' : 'apply',
  added: dryRun ? [] : missing.map(([name]) => name),
  alreadyPresent: Object.keys(TASK_CONTROL_TASK_PROPERTIES).filter((name) => !missing.some(([missingName]) => missingName === name)),
  pending: dryRun ? missing.map(([name]) => name) : [],
}, null, 2));

export { TASK_CONTROL_TASK_PROPERTIES };
