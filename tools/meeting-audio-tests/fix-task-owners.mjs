import fs from 'node:fs';
const env = {};
for (const l of fs.readFileSync('D:/Codex_project/AM_Core/.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const WRITE = process.argv.includes('--write');
const PID = '39a51c686dac81d19901c7b89c044da4';
const TASKS = env.ENG_TASKS_DATA_SOURCE_ID;
const notion = async (p, method = 'GET', body) => { const r = await fetch('https://api.notion.com' + p, { method, headers: { Authorization: 'Bearer ' + env.NOTION_TOKEN, 'Notion-Version': env.NOTION_VERSION || '2025-09-03', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(p + ' ' + r.status + ' ' + JSON.stringify(j).slice(0, 200)); return j; };
const rt = (a) => (a || []).map((x) => x.plain_text).join('');
const swapName = (s) => (s === 'Seven' ? '其勳' : s === '其勳' ? 'Seven' : s);

const q = await notion(`/v1/data_sources/${TASKS}/query`, 'POST', { filter: { property: '會議記錄', relation: { contains: PID } }, page_size: 50 });
console.log(`連到本會議的待辦任務:${q.results.length}`);
const changes = [];
for (const p of q.results) {
  const owner = rt(p.properties?.['負責人']?.rich_text);
  const content = rt(p.properties?.['內容']?.title);
  const no = swapName(owner);
  if (no !== owner) changes.push({ id: p.id, content, owner, no });
}
for (const c of changes) console.log(`  「${c.content.slice(0, 30)}」 負責人 ${c.owner} → ${c.no}`);
if (!WRITE) { console.log('\n(乾跑,未寫入。加 --write)'); process.exit(0); }
let ok = 0;
for (const c of changes) { await notion(`/v1/pages/${c.id}`, 'PATCH', { properties: { '負責人': { rich_text: [{ type: 'text', text: { content: c.no } }] } } }); ok++; }
console.log(`\n✅ 已更新 ${ok}/${changes.length} 個任務負責人`);
