// Provision the shared Notion foundation for any AM Platform tenant.
// Creates only tenant-local databases under the declared parent page and records IDs in .env.
// Usage:
//   node tools/provision-tenant-foundation.mjs <tenant-key> --parent-page=<id> --drive-root=<id>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const tenantKey = process.argv[2];
const args = Object.fromEntries(process.argv.slice(3).map((item) => {
  const match = item.match(/^--([^=]+)=(.*)$/);
  return match ? [match[1], match[2]] : [item.replace(/^--/, ''), true];
}));

if (!tenantKey) throw new Error('Usage: node tools/provision-tenant-foundation.mjs <tenant-key> --parent-page=<id> --drive-root=<id>');
const tenantPath = path.join(root, 'tenants', `${tenantKey}.json`);
if (!fs.existsSync(tenantPath)) throw new Error(`Unknown tenant: ${tenantKey}`);
const tenant = JSON.parse(fs.readFileSync(tenantPath, 'utf8'));
const prefix = tenant.envPrefix;

function readEnv() {
  const values = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values[match[1]] = match[2].trim();
  }
  return values;
}

function writeEnv(updates) {
  let content = fs.readFileSync(envPath, 'utf8');
  for (const [key, value] of Object.entries(updates)) {
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    if (pattern.test(content)) content = content.replace(pattern, `${key}=${value}`);
    else content += `${content.endsWith('\n') ? '' : '\n'}${key}=${value}\n`;
  }
  fs.writeFileSync(envPath, content);
}

let env = readEnv();
const parentKey = `${prefix}_NOTION_PARENT_PAGE_ID`;
const driveKey = `${prefix}_DRIVE_ROOT_FOLDER_ID`;
const parentPageId = String(args['parent-page'] || env[parentKey] || '').replace(/-/g, '');
const driveRootId = String(args['drive-root'] || env[driveKey] || '');
if (!parentPageId) throw new Error(`${parentKey} or --parent-page is required.`);
if (!driveRootId) throw new Error(`${driveKey} or --drive-root is required.`);
writeEnv({ [parentKey]: parentPageId, [`${prefix}_MEETINGS_PARENT_PAGE_ID`]: parentPageId, [driveKey]: driveRootId });
env = readEnv();

const notionToken = env.NOTION_TOKEN;
const notionVersion = env.NOTION_VERSION || '2025-09-03';
if (!notionToken) throw new Error('NOTION_TOKEN is required.');

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

const text = { rich_text: {} };
const date = { date: {} };
const number = { number: {} };
const checkbox = { checkbox: {} };
const url = { url: {} };
const files = { files: {} };
const select = (...names) => ({ select: { options: names.map((name) => ({ name })) } });
const multi = (...names) => ({ multi_select: { options: names.map((name) => ({ name })) } });
const relation = (dataSourceId) => ({ relation: { data_source_id: dataSourceId, single_property: {} } });

const ids = {};
function envKey(name) { return `${prefix}_${name}_DATA_SOURCE_ID`; }

async function create(name, title, properties) {
  const key = envKey(name);
  if (env[key]) {
    ids[name] = env[key];
    console.log(`SKIP ${title}: ${env[key]}`);
    return env[key];
  }
  const created = await notion('/v1/databases', {
    method: 'POST',
    body: {
      parent: { type: 'page_id', page_id: parentPageId },
      title: [{ type: 'text', text: { content: title } }],
      initial_data_source: { properties },
    },
  });
  const id = created.data_sources?.[0]?.id;
  if (!id) throw new Error(`Created ${title}, but no data source ID was returned.`);
  ids[name] = id;
  writeEnv({ [key]: id });
  env[key] = id;
  console.log(`CREATE ${title}: ${id}`);
  return id;
}

await notion(`/v1/pages/${parentPageId}`);

await create('PROJECTS', '專案', {
  '專案名稱': { title: {} }, '館別代碼': text, '專案別名': text, '專案說明': text,
  '專案負責人': text, '參與者': text,
  '狀態': select('待分類', '規劃中', '進行中', '等待中', '暫停', '已完成', '已取消'),
  '階段': text, '優先級': select('低', '一般', '高', '緊急'), '開始日期': date, '目標日期': date,
  '最新摘要': text, '下一步': text, '阻礙': text, '風險': text, '最後更新': date,
});

await create('SPACES', '營運範圍', {
  '名稱': { title: {} }, '專案': relation(ids.PROJECTS), '區/棟': text,
  '類型': select('館別', '部門', '營運主題', '合作案', '其他'),
});

await create('WORK_ITEMS', '工作項目', {
  '工項': { title: {} }, '空間': relation(ids.SPACES), '專案': relation(ids.PROJECTS),
  '工種': select('營運', '櫃檯', '房務', '工務', '業務', '行銷', '財務', '人資', '其他'),
  '狀態': select('未開始', '進行中', '等待中', '待確認', '完成', '取消'), '負責工班': text,
});

await create('GROUP_BINDINGS', '群組綁定', {
  '群組名稱': { title: {} }, 'LINE 群組 ID': text, '專案': relation(ids.PROJECTS),
  '群組角色': select('總管', '內部', '專案', '部門', '外部合作'), '工種': select('營運', '房務', '工務', '行銷', '其他'),
  '狀態': select('啟用', '影子記錄', '停用'), '成員對照': text, '我方主管': text, '對方主管': text,
  '群組用途': text, '主要負責人': text,
  '啟用功能': multi('訊息收集', '待辦', '會議', '案件狀態', '照片', '提醒'),
  '所屬目標': text, '狀態更新權限': select('所有成員', '主要負責人', '總管'),
  '預設提醒對象': text, '最後設定時間': date, '最後設定者': text, '會議資料庫': text,
});

await create('MEETINGS', '會議記錄（備援）', {
  '會議': { title: {} },
  '類型': select(...(tenant.config?.meetings?.types || ['一般會議'])),
  '日期': date, '參與者': text, '專案': relation(ids.PROJECTS),
});

await create('TASKS', '待辦任務', {
  '內容': { title: {} }, '專案': relation(ids.PROJECTS), '負責人': text, '期限': date,
  '來源': select('會議', '回饋單', '手動'), '狀態': select('待辦', '進行中', '完成', '取消'),
  '優先級': select('低', '一般', '高', '緊急'), '逾期': checkbox,
  '會議記錄': relation(ids.MEETINGS), '負責群組': relation(ids.GROUP_BINDINGS),
  '等待對象': text, '阻礙': text, '來源證據': text, '提醒記錄': text,
});

await create('MESSAGES', '原始訊息', {
  '訊息': { title: {} }, '內容': text, '群組綁定': relation(ids.GROUP_BINDINGS),
  'LINE 群組 ID': text, 'LINE 訊息 ID': text, '發送者': text, '時間': date,
  '訊息類型': select('文字', '照片', '檔案', '貼圖', '其他'),
  '掛載狀態': select('未掛載', 'AI初判待確認', '已確認', '一般對話'),
  '專案': relation(ids.PROJECTS), '空間': relation(ids.SPACES), '工項': relation(ids.WORK_ITEMS),
  'AI 訊息類型': select('任務', '決策', '請求', '問題', '進度回報', '承諾', '風險', '資訊', '提問', '完成', '取消', '變更', '一般對話'),
  'AI 信心度': select('高', '中', '低'), 'AI 初判結果': text, '確認者': text, '確認時間': date,
  '回覆訊息 ID': text, '附件連結': url, '擷取文字': text, '處理狀態': select('待處理', '已處理', '失敗'),
});

await create('ATTACHMENTS', '附件', {
  '附件項目': { title: {} }, '訊息': relation(ids.MESSAGES), '檔案': files,
  '專案': relation(ids.PROJECTS), '空間': relation(ids.SPACES), '工項': relation(ids.WORK_ITEMS),
  '日期': date, '檔案名稱': text, '檔案大小': number, 'Drive 連結': url, 'AI影像判讀': text,
});

await create('EVENTS', '事件', {
  '事件': { title: {} }, '類型': select('Task', 'Decision', 'Request', 'Issue', 'Progress Update', 'Commitment', 'Meeting', 'Risk', 'Information', 'Question', 'Completion', 'Cancellation', 'Change'),
  '摘要': text, '專案': relation(ids.PROJECTS), '關聯任務': relation(ids.TASKS), '來源訊息': relation(ids.MESSAGES),
  '主題': text, '相關人員': text, '負責人': text, '狀態': select('候選', '有效', '已取代', '已關閉'),
  '優先級': select('低', '一般', '高', '緊急'), '事件時間': date, '期限': date, '信心度': number, '取代事件 ID': text,
});

await create('DECISIONS', '決策紀錄', {
  '決策': { title: {} }, '專案': relation(ids.PROJECTS), '決策內容': text, '決策者': text, '決策日期': date,
  '背景': text, '考慮方案': text, '原因': text, '影響': text, '生效日期': date,
  '狀態': select('草稿', '目前有效', '已取代', '已撤銷'), '取代者': text, '來源證據': text,
});

await create('KNOWLEDGE_ITEMS', '公司知識', {
  '標題': { title: {} }, '分類': select('SOP', '公司政策', '旅宿營運', '合作條件', '常見問題', '品牌規範', '歷史經驗'),
  '內容': text, '適用範圍': text, '負責人': text, '生效日期': date, '到期日期': date,
  '版本': text, '狀態': select('草稿', '待確認', '正式', '已失效'), '來源證據': text, '最後檢視日期': date,
});

await create('TASK_HISTORY', '任務歷程', {
  '歷程': { title: {} }, '任務': relation(ids.TASKS), '變更時間': date, '原狀態': text, '新狀態': text,
  '變更摘要': text, '來源訊息': relation(ids.MESSAGES), '來源證據': text, '偵測者': text,
});

await create('DAILY_SUMMARIES', '每日收斂', {
  '摘要': { title: {} }, '日期': date, '專案': relation(ids.PROJECTS), '新增任務': text,
  '進度': text, '完成事項': text, '等待事項': text, '未回答問題': text, '衝突資訊': text,
});

await create('PROJECT_SNAPSHOTS', '專案快照', {
  '快照': { title: {} }, '專案': relation(ids.PROJECTS), '日期': date, '目前狀態': text,
  '本期完成': text, '下一步': text, '負責人': text, '阻礙': text, '風險': text, '待決策事項': text,
});

await create('ANSWER_LOGS', '查詢回答紀錄', {
  '問題': { title: {} }, '提問時間': date, '提問者': text, '提問群組': relation(ids.GROUP_BINDINGS),
  '辨識意圖': text, '查詢資料': text, '回答': text, '引用來源': text, '信心度': number,
  '回饋': select('正確', '部分正確', '不正確', '未回饋'),
});

console.log(JSON.stringify({ ok: true, tenant: tenantKey, parentPageId, driveRootId, dataSources: ids }, null, 2));
