import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const projectName = args.project || 'AM Project';
const projectRoot = args.root ? path.resolve(args.root) : process.cwd();
const tasksEnvName = args['tasks-env'] || 'TASKS_DATA_SOURCE_ID';

loadDotenv(path.join(projectRoot, '.env'));

const notionToken = process.env.NOTION_TOKEN;
const tasksDataSourceId = process.env[tasksEnvName] || process.env.TASKS_DATA_SOURCE_ID || '';

if (!notionToken) {
  throw new Error('NOTION_TOKEN is not set in the project .env.');
}
if (!tasksDataSourceId) {
  throw new Error(`${tasksEnvName} is not set in the project .env.`);
}

const dataSource = await notionRequest(`/v1/data_sources/${tasksDataSourceId}`, { method: 'GET' });
const missingSchema = ['截止日', '期限依據', '下次追蹤日', '逾期狀態'].filter((name) => !dataSource.properties?.[name]);
if (missingSchema.length) {
  throw new Error(`Missing deadline schema fields: ${missingSchema.join(', ')}`);
}

const pages = await queryAllTasks(tasksDataSourceId);
const activePages = pages.filter((page) => !isClosedTask(page));
const missingDeadline = activePages.filter((page) => !dateOnly(firstPageText(page, ['截止日', '期限', 'Due Date', 'Deadline'])));
const missingBasis = activePages.filter((page) => !firstPageText(page, ['期限依據', '截止日依據', 'Deadline Basis']));
const missingFollowup = activePages.filter((page) => !dateOnly(firstPageText(page, ['下次追蹤日', '下次追蹤日期', 'Next Follow-up Date'])));
const missingOverdue = activePages.filter((page) => !firstPageText(page, ['逾期狀態', 'Deadline Status', 'Overdue Status']));

if (missingDeadline.length || missingBasis.length || missingFollowup.length || missingOverdue.length) {
  throw new Error(JSON.stringify({
    missingDeadline: missingDeadline.length,
    missingBasis: missingBasis.length,
    missingFollowup: missingFollowup.length,
    missingOverdue: missingOverdue.length,
  }));
}

console.log(JSON.stringify({
  ok: true,
  project: projectName,
  totalTasks: pages.length,
  activeTasks: activePages.length,
  schemaFields: ['截止日', '期限依據', '下次追蹤日', '逾期狀態'],
}, null, 2));

async function queryAllTasks(dataSourceId) {
  const results = [];
  let startCursor;
  do {
    const body = { page_size: 100 };
    if (startCursor) body.start_cursor = startCursor;
    const result = await notionRequest(`/v1/data_sources/${dataSourceId}/query`, { method: 'POST', body });
    results.push(...(result.results || []));
    startCursor = result.has_more ? result.next_cursor : null;
  } while (startCursor);
  return results;
}

async function notionRequest(pathname, { method, body }) {
  const response = await fetch(`https://api.notion.com${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${notionToken}`,
      'Content-Type': 'application/json',
      'Notion-Version': process.env.NOTION_VERSION || '2025-09-03',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Notion API failed: ${response.status} ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

function isClosedTask(page) {
  const status = firstPageText(page, ['狀態', 'Status']);
  return /已完成|封存|完成|退回|Deprecated|Archived/i.test(status);
}

function firstPageText(page, names) {
  for (const name of names) {
    const text = pageText(page, name);
    if (text) return text;
  }
  return '';
}

function pageText(page, propertyName) {
  const property = page?.properties?.[propertyName];
  if (!property) return '';
  if (property.type === 'title') return plain(property.title);
  if (property.type === 'rich_text') return plain(property.rich_text);
  if (property.type === 'select') return property.select?.name || '';
  if (property.type === 'multi_select') return (property.multi_select || []).map((item) => item.name).join(', ');
  if (property.type === 'status') return property.status?.name || '';
  if (property.type === 'date') return property.date?.start || '';
  if (property.type === 'url') return property.url || '';
  if (property.type === 'number') return property.number === null || property.number === undefined ? '' : String(property.number);
  return '';
}

function plain(items) {
  return (items || []).map((item) => item.plain_text || item.text?.content || '').join('');
}

function dateOnly(value) {
  return String(value || '').match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';
}

function loadDotenv(filePath) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}
