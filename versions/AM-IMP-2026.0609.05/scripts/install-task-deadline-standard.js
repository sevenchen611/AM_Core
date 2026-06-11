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

const today = taipeiDateOnly(new Date());
const dataSource = await notionRequest(`/v1/data_sources/${tasksDataSourceId}`, { method: 'GET' });
await ensureDeadlineSchema(tasksDataSourceId, dataSource.properties || {});
const taskPages = await queryAllTasks(tasksDataSourceId);

let updated = 0;
let skipped = 0;
for (const page of taskPages) {
  if (isClosedTask(page)) {
    skipped += 1;
    continue;
  }

  const dueDate = firstPageText(page, ['截止日', '期限', 'Due Date', 'Deadline']);
  const basis = firstPageText(page, ['期限依據', '截止日依據', 'Deadline Basis']);
  const followup = firstPageText(page, ['下次追蹤日', '下次追蹤日期', 'Next Follow-up Date']);
  const overdueStatus = firstPageText(page, ['逾期狀態', 'Deadline Status', 'Overdue Status']);
  const inferred = inferDeadline(page, today);
  const finalDueDate = dateOnly(dueDate) || inferred.dueDate;
  const finalFollowup = dateOnly(followup) || earlierDate(addDaysTaipei(today, 1), finalDueDate);
  const finalOverdueStatus = overdueStatus || computeOverdueStatus(finalDueDate, today, page);
  const properties = {};

  if (!dateOnly(dueDate) && page.properties?.截止日) {
    properties.截止日 = { date: { start: finalDueDate } };
  }
  if (!basis && page.properties?.期限依據) {
    properties.期限依據 = richTextProperty(inferred.basis);
  }
  if (!dateOnly(followup) && page.properties?.下次追蹤日) {
    properties.下次追蹤日 = { date: { start: finalFollowup } };
  }
  if (!overdueStatus && page.properties?.逾期狀態) {
    properties.逾期狀態 = selectProperty(finalOverdueStatus);
  }

  if (Object.keys(properties).length) {
    await notionRequest(`/v1/pages/${page.id}`, { method: 'PATCH', body: { properties } });
    updated += 1;
    await sleep(120);
  } else {
    skipped += 1;
  }
}

console.log(JSON.stringify({
  ok: true,
  project: projectName,
  tasksDataSourceId,
  totalTasks: taskPages.length,
  updated,
  skipped,
  today,
}, null, 2));

async function ensureDeadlineSchema(dataSourceId, properties) {
  const patch = {};
  if (!properties.截止日) {
    patch.截止日 = { date: {} };
  }
  if (!properties.期限依據) {
    patch.期限依據 = { rich_text: {} };
  }
  if (!properties.下次追蹤日) {
    patch.下次追蹤日 = { date: {} };
  }
  if (!properties.逾期狀態) {
    patch.逾期狀態 = {
      select: {
        options: [
          { name: '需補期限', color: 'gray' },
          { name: '未逾期', color: 'green' },
          { name: '今天到期', color: 'yellow' },
          { name: '已逾期', color: 'red' },
          { name: '已完成', color: 'blue' },
        ],
      },
    };
  }

  if (Object.keys(patch).length) {
    await notionRequest(`/v1/data_sources/${dataSourceId}`, {
      method: 'PATCH',
      body: { properties: patch },
    });
  }
}

function inferDeadline(page, todayText) {
  const haystack = [
    pageTitle(page),
    firstPageText(page, ['下一步', 'Codex 判斷摘要', '判斷摘要', '來源原文']),
  ].join('\n');

  if (/今天|今日/.test(haystack)) {
    return { dueDate: todayText, basis: '對話推定：文字提到今天，截止日設為今天。' };
  }
  if (/明天|明日/.test(haystack)) {
    return { dueDate: addDaysTaipei(todayText, 1), basis: '對話推定：文字提到明天，截止日設為明天。' };
  }
  if (/下週二|下星期二/.test(haystack)) {
    return { dueDate: nextWeekdayTaipei(todayText, 2, true), basis: '對話推定：文字提到下週二，截止日設為下週二。' };
  }
  if (/週三|星期三|禮拜三/.test(haystack)) {
    return { dueDate: nextWeekdayTaipei(todayText, 3, false), basis: '對話推定：文字提到週三，截止日設為最近的週三。' };
  }
  const confirmation = firstPageText(page, ['確認狀態']);
  const status = firstPageText(page, ['狀態']);
  if (/待確認|未確認/.test(`${confirmation} ${status}`)) {
    return {
      dueDate: addDaysTaipei(todayText, 1),
      basis: '系統預設：待確認任務應在 1 天內補齊負責人、期限或成立判斷。',
    };
  }
  return {
    dueDate: addDaysTaipei(todayText, 3),
    basis: '系統預設：一般進行中任務應在 3 天內完成或重新確認期限。',
  };
}

function computeOverdueStatus(dueDate, todayText, page) {
  if (isClosedTask(page)) return '已完成';
  if (!dueDate) return '需補期限';
  if (dueDate < todayText) return '已逾期';
  if (dueDate === todayText) return '今天到期';
  return '未逾期';
}

function isClosedTask(page) {
  const status = firstPageText(page, ['狀態', 'Status']);
  return /已完成|封存|完成|退回|Deprecated|Archived/i.test(status);
}

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

function pageTitle(page) {
  const titleProperty = Object.values(page.properties || {}).find((property) => property.type === 'title');
  return plain(titleProperty?.title || []);
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

function richTextProperty(value) {
  return { rich_text: [{ text: { content: clampText(value) } }] };
}

function selectProperty(name) {
  return { select: { name } };
}

function clampText(value) {
  const text = String(value || '');
  return text.length > 1900 ? `${text.slice(0, 1897)}...` : text;
}

function dateOnly(value) {
  return String(value || '').match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';
}

function taipeiDateOnly(value) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value instanceof Date ? value : new Date(value));
}

function addDaysTaipei(dateText, days) {
  const date = new Date(`${dateText}T00:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return taipeiDateOnly(date);
}

function nextWeekdayTaipei(dateText, weekday, forceNextWeek) {
  const [year, month, day] = dateText.split('-').map(Number);
  const current = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  let delta = (weekday - current + 7) % 7;
  if (delta === 0 || forceNextWeek) delta += 7;
  return addDaysTaipei(dateText, delta);
}

function earlierDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
