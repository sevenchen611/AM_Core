const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const projectKey = (process.argv[2] || '').toUpperCase();
const write = process.argv.includes('--write');
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;

const projects = {
  HOZO_AM: {
    displayName: 'HOZO AM',
    localPath: 'D:\\Codex_project\\HOZO_AM\\line-oa-webhook',
    envName: 'HOZO_TASKS_DATA_SOURCE_ID',
    fallbackDataSourceId: '9c9e34ff-45af-4543-a3ae-11c5cd432b36',
    manifestPath: 'D:\\Codex_project\\HOZO_AM\\line-oa-webhook\\docs\\project-improvement-manifest.md',
  },
  SEVEN_AM: {
    displayName: 'SevenAM',
    localPath: 'D:\\Codex_project\\SevenAM\\line-oa-webhook',
    envName: 'SEVEN_TASKS_DATA_SOURCE_ID',
    fallbackDataSourceId: '0bdc0de5-46ee-482c-b8d7-cdf6ec958467',
    manifestPath: 'D:\\Codex_project\\SevenAM\\line-oa-webhook\\docs\\project-improvement-manifest.md',
  },
};

if (!projects[projectKey]) {
  console.error('Usage: node tools/apply-task-body-evidence-log-standard.js HOZO_AM|SEVEN_AM [--write] [--limit=N]');
  process.exit(1);
}

const project = projects[projectKey];
loadEnv(path.join(project.localPath, '.env'));

const notionToken = process.env.NOTION_TOKEN;
const notionVersion = process.env.NOTION_VERSION || '2025-09-03';
const tasksDataSourceId = process.env[project.envName] || project.fallbackDataSourceId;

if (!notionToken) throw new Error(`${project.displayName}: NOTION_TOKEN is not set in project-local environment.`);
if (!tasksDataSourceId) throw new Error(`${project.displayName}: ${project.envName} is not set.`);

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

async function main() {
  const tasks = await queryAllTasks(tasksDataSourceId);
  const changed = [];
  const skipped = [];
  const failed = [];

  for (const task of tasks.slice(0, limit)) {
    const title = pageText(task, '任務名稱') || '(未命名任務)';
    const children = await listBlockChildren(task.id);
    const oldBody = blocksToPlainText(children).trim();
    const alreadyStandard = /^#?\s*任務控制紀錄\b/m.test(oldBody)
      || /完整來源原文已依 AM-IMP-2026\.0610\.03/.test(pageText(task, '來源原文'));

    const sourceOriginal = pageText(task, '來源原文');
    const body = buildTaskBody({ task, oldBody, sourceOriginal, alreadyStandard });
    const propertyUpdates = {
      '來源原文': richTextProperty('完整來源原文已依 AM-IMP-2026.0610.03 寫入內文各筆「證據與處理紀錄」中的「來源原文」區塊；此欄位僅保留為相容提示。'),
    };

    if (alreadyStandard) {
      skipped.push({ title, url: task.url, reason: 'already-standard; compatibility property only' });
      if (write) {
        try {
          await updatePageProperties(task.id, propertyUpdates);
        } catch (error) {
          failed.push({ title, url: task.url, error: error.message });
        }
      }
      continue;
    }

    changed.push({ title, url: task.url });
    if (!write) continue;

    try {
      await archiveChildren(children);
      await appendChildren(task.id, markdownToBlocks(body));
      await updatePageProperties(task.id, propertyUpdates);
    } catch (error) {
      failed.push({ title, url: task.url, error: error.message });
    }
  }

  console.log(JSON.stringify({
    ok: failed.length === 0,
    project: projectKey,
    write,
    dataSourceId: tasksDataSourceId,
    scanned: Math.min(tasks.length, limit),
    totalTasks: tasks.length,
    converted: write ? changed.length - failed.length : 0,
    wouldConvert: write ? 0 : changed.length,
    alreadyStandard: skipped.length,
    failed,
    sampleChanged: changed.slice(0, 10),
    sampleSkipped: skipped.slice(0, 10),
  }, null, 2));

  if (failed.length) process.exit(1);
}

function buildTaskBody({ task, oldBody, sourceOriginal, alreadyStandard }) {
  const title = pageText(task, '任務名稱') || '(未命名任務)';
  const projectName = pageText(task, '專案') || relationText(task, '總控專案') || '未設定';
  const status = pageText(task, '狀態') || '未設定';
  const owner = pageText(task, '負責人') || '未設定';
  const nextStep = pageText(task, '下一步') || pageText(task, '下一步給負責人') || '未設定';
  const confirmation = pageText(task, '確認狀態') || '未設定';
  const confidence = pageText(task, '信心等級') || '未設定';
  const sourceType = pageText(task, '來源') || '未設定';
  const judgment = pageText(task, 'Codex 判斷摘要') || '原任務未提供 Codex 判斷摘要；本次先依既有欄位套用新版任務控制紀錄格式。';
  const sourceUrl = pageText(task, '關聯 Notion 頁面');
  const sourceLocation = sourceUrl
    ? `[${sourceType} / 關聯 Notion 頁面](${sourceUrl})`
    : `${sourceType} / 未設定來源頁面`;
  const sourceTime = pageDate(task, '最後更新') || pageDate(task, '下次追蹤日') || '未設定';
  const sourceBody = sourceOriginal || '原任務的「來源原文」欄位沒有可搬入內容；請回查關聯 Notion 頁面或舊內文封存。';

  const oldBodySection = oldBody
    ? [
        '',
        '#### 舊內文封存',
        '',
        oldBody,
      ].join('\n')
    : '';

  return [
    '# 任務控制紀錄',
    '',
    '## 目前任務摘要',
    `- 任務：${title}`,
    `- 專案目標：${projectName}`,
    `- 目前狀態：${status}`,
    `- 負責人：${owner}`,
    `- 下一步：${nextStep}`,
    `- 需要確認：${confirmation === '已確認' ? '目前確認狀態為已確認；後續依任務狀態與下一步追蹤。' : confirmation}`,
    '',
    '## 最新判斷',
    `- 判斷時間：2026/06/10（批次套用 AM-IMP-2026.0610.03）`,
    `- 判斷來源：${sourceType}`,
    `- 判斷結果：${judgment}`,
    '- 判斷理由：本次批次套用先保留既有任務欄位、來源原文與舊內文，讓後續 AM 判斷可以在同一份任務控制紀錄中接續追加。',
    `- 信心程度：${confidence}`,
    `- 是否需要人工確認：${confirmation === '已確認' ? '否，除非後續證據改變任務狀態。' : '是，請依任務確認狀態補齊。'}`,
    '',
    '## 證據與處理紀錄',
    '',
    '### 紀錄 1',
    '- 擷取時間：2026/06/10（批次套用新版格式）',
    `- 來源類型：${sourceType}`,
    `- 來源位置：${sourceLocation}`,
    `- 來源時間：${sourceTime}`,
    `- 來源對象：${owner}`,
    '',
    '#### 來源原文',
    '',
    sourceBody,
    '',
    '#### 證據摘要',
    '',
    sourceOriginal
      ? '本紀錄由原任務的「來源原文」欄位搬入，並與既有任務欄位合併成新版任務控制紀錄。'
      : '原任務沒有可用的來源原文欄位內容；本紀錄保留舊內文與欄位摘要，需後續回查來源頁補齊完整原文。',
    '',
    '#### AM 判斷',
    '',
    judgment,
    '',
    '#### 處理結果',
    '',
    alreadyStandard
      ? '此任務已是新版格式；本次只確認相容欄位。'
      : '已將任務頁套用 AM-IMP-2026.0610.03 新版「任務控制紀錄」格式，並將舊內文封存於本紀錄下方。',
    '',
    '#### 狀態變更',
    '',
    `維持既有狀態：${status}`,
    '',
    '#### 下一步',
    '',
    nextStep,
    '',
    '#### 關聯規則',
    '',
    'AM-IMP-2026.0610.03：任務內文必須以追加式「證據與處理紀錄」保存來源原文、證據摘要、AM 判斷、處理結果與下一步。來源位置在可用時應連回專案本地來源頁。',
    oldBodySection,
  ].join('\n');
}

async function queryAllTasks(dataSourceId) {
  const results = [];
  let startCursor = undefined;
  do {
    const body = { page_size: 100 };
    if (startCursor) body.start_cursor = startCursor;
    const result = await notionRequest(`/v1/data_sources/${dataSourceId}/query`, { method: 'POST', body });
    results.push(...(result.results || []));
    startCursor = result.has_more ? result.next_cursor : undefined;
  } while (startCursor);
  return results;
}

async function listBlockChildren(blockId) {
  const results = [];
  let startCursor = undefined;
  do {
    const query = new URLSearchParams({ page_size: '100' });
    if (startCursor) query.set('start_cursor', startCursor);
    const result = await notionRequest(`/v1/blocks/${blockId}/children?${query}`, { method: 'GET' });
    results.push(...(result.results || []));
    startCursor = result.has_more ? result.next_cursor : undefined;
  } while (startCursor);
  return results;
}

async function archiveChildren(children) {
  for (const child of children) {
    await notionRequest(`/v1/blocks/${child.id}`, { method: 'PATCH', body: { archived: true } });
  }
}

async function appendChildren(pageId, blocks) {
  for (const group of chunk(blocks, 80)) {
    await notionRequest(`/v1/blocks/${pageId}/children`, {
      method: 'PATCH',
      body: { children: group },
    });
  }
}

async function updatePageProperties(pageId, properties) {
  await notionRequest(`/v1/pages/${pageId}`, {
    method: 'PATCH',
    body: { properties },
  });
}

async function notionRequest(endpoint, { method = 'GET', body } = {}) {
  const response = await fetch(`https://api.notion.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${notionToken}`,
      'Notion-Version': notionVersion,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${endpoint} ${response.status}: ${json.message || 'Notion request failed'}`);
  return json;
}

function markdownToBlocks(markdown) {
  const blocks = [];
  const lines = markdown.split(/\r?\n/);
  let paragraph = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    const text = paragraph.join('\n').trim();
    paragraph = [];
    if (!text) return;
    for (const part of splitText(text, 1800)) {
      blocks.push(paragraphBlock(part));
    }
  }

  for (const line of lines) {
    if (line.startsWith('# ')) {
      flushParagraph();
      blocks.push(headingBlock('heading_1', line.slice(2)));
    } else if (line.startsWith('## ')) {
      flushParagraph();
      blocks.push(headingBlock('heading_2', line.slice(3)));
    } else if (line.startsWith('### ')) {
      flushParagraph();
      blocks.push(headingBlock('heading_3', line.slice(4)));
    } else if (line.startsWith('#### ')) {
      flushParagraph();
      blocks.push(paragraphBlock(line.slice(5), { bold: true }));
    } else if (line.startsWith('- ')) {
      flushParagraph();
      blocks.push(bulletedBlock(line.slice(2)));
    } else if (!line.trim()) {
      flushParagraph();
    } else {
      paragraph.push(line);
    }
  }
  flushParagraph();
  return blocks;
}

function headingBlock(type, text) {
  return { object: 'block', type, [type]: { rich_text: richTextArray(text) } };
}

function paragraphBlock(text, annotations = {}) {
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: richTextArray(text, annotations) } };
}

function bulletedBlock(text) {
  return { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: richTextArray(text) } };
}

function richTextArray(text, annotations = {}) {
  const output = [];
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(text))) {
    if (match.index > last) output.push(textRich(text.slice(last, match.index), annotations));
    output.push(textRich(match[1], annotations, match[2]));
    last = pattern.lastIndex;
  }
  if (last < text.length) output.push(textRich(text.slice(last), annotations));
  return output.length ? output : [textRich('', annotations)];
}

function textRich(content, annotations = {}, url) {
  return {
    type: 'text',
    text: { content: String(content || '').slice(0, 2000), ...(url ? { link: { url } } : {}) },
    annotations,
  };
}

function richTextProperty(value) {
  return { rich_text: splitText(value, 1900).map((part) => ({ type: 'text', text: { content: part } })) };
}

function splitText(text, size) {
  const value = String(text || '');
  const parts = [];
  for (let i = 0; i < value.length; i += size) parts.push(value.slice(i, i + size));
  return parts.length ? parts : [''];
}

function chunk(items, size) {
  const groups = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

function blocksToPlainText(blocks) {
  return blocks.map(blockToPlainText).filter(Boolean).join('\n');
}

function blockToPlainText(block) {
  const type = block.type;
  const value = block[type];
  const text = richText(value?.rich_text || value?.caption || []);
  if (!text) return '';
  if (type === 'heading_1') return `# ${text}`;
  if (type === 'heading_2') return `## ${text}`;
  if (type === 'heading_3') return `### ${text}`;
  if (type === 'bulleted_list_item') return `- ${text}`;
  if (type === 'numbered_list_item') return `1. ${text}`;
  return text;
}

function pageText(page, name) {
  const prop = page.properties?.[name];
  if (!prop) return '';
  if (prop.type === 'title') return richText(prop.title);
  if (prop.type === 'rich_text') return richText(prop.rich_text);
  if (prop.type === 'select') return prop.select?.name || '';
  if (prop.type === 'multi_select') return (prop.multi_select || []).map((item) => item.name).join(', ');
  if (prop.type === 'url') return prop.url || '';
  if (prop.type === 'number') return prop.number == null ? '' : String(prop.number);
  if (prop.type === 'date') return prop.date?.start || '';
  return '';
}

function pageDate(page, name) {
  const prop = page.properties?.[name];
  return prop?.type === 'date' ? prop.date?.start || '' : '';
}

function relationText(page, name) {
  const prop = page.properties?.[name];
  if (prop?.type !== 'relation') return '';
  return (prop.relation || []).map((item) => item.id).join(', ');
}

function richText(value) {
  return (value || []).map((item) => item.plain_text || item.text?.content || '').join('').trim();
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
