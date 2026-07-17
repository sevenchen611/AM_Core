import fs from 'node:fs';
const env = {};
for (const l of fs.readFileSync('D:/Codex_project/AM_Core/.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const WRITE = process.argv.includes('--write');
const PID = '39a51c686dac81d19901c7b89c044da4';
const notion = async (p, method = 'GET', body) => { const r = await fetch('https://api.notion.com' + p, { method, headers: { Authorization: 'Bearer ' + env.NOTION_TOKEN, 'Notion-Version': env.NOTION_VERSION || '2025-09-03', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(p + ' ' + r.status + ' ' + JSON.stringify(j).slice(0, 200)); return j; };
const rt = (a) => (a || []).map((x) => x.plain_text).join('');
const kids = async (id) => { let cur, out = []; do { const r = await notion(`/v1/blocks/${id}/children?page_size=100${cur ? `&start_cursor=${cur}` : ''}`); out.push(...(r.results || [])); cur = r.has_more ? r.next_cursor : null; } while (cur); return out; };

// 佔位符順序交換:先換帶職稱的完整標籤,再換裸名(哨兵用不可能出現在文中的字串)
const P1 = '@@S1@@', P2 = '@@S2@@', P3 = '@@S3@@', P4 = '@@S4@@';
function swap(s) {
  return s
    .split('Seven(負責人)').join(P1)
    .split('其勳(現場工務主任)').join(P2)
    .split('Seven').join(P3)
    .split('其勳').join(P4)
    .split(P1).join('其勳(現場工務主任)')
    .split(P2).join('Seven(負責人)')
    .split(P3).join('其勳')
    .split(P4).join('Seven');
}
// 排除:來源、錄音原檔、分段導覽(含上傳者 LINE 名「Seven陳聖文」,絕不可換)
const EXCLUDE = /^\[來源\]|^🎙 錄音原檔|^本會議分三段/;
const setRT = (type, content) => ({ [type]: { rich_text: [{ type: 'text', text: { content: content.slice(0, 2000) } }] } });

const targets = [];
const top = await kids(PID);
for (const b of top) {
  const t = b[b.type]; const txt = rt(t?.rich_text);
  if (b.type === 'paragraph') { if (!txt || EXCLUDE.test(txt)) continue; if (/Seven|其勳/.test(txt)) { const a = swap(txt); if (a !== txt) targets.push({ id: b.id, type: 'paragraph', before: txt, after: a }); } }
  if (b.type === 'heading_2' && t?.is_toggleable) {
    for (const s of await kids(b.id)) {
      const st = s[s.type]; const stx = rt(st?.rich_text); if (!stx) continue;
      if (/Seven|其勳/.test(stx)) { const a = swap(stx); if (a !== stx) targets.push({ id: s.id, type: s.type, before: stx, after: a, checked: st?.checked }); }
    }
  }
}
console.log(`需修改區塊:${targets.length}`);
for (const t of targets.slice(0, 8)) { console.log(`\n[${t.type}] ${t.id.slice(0, 8)}`); console.log('  舊: ' + t.before.slice(0, 100)); console.log('  新: ' + t.after.slice(0, 100)); }
console.log('\n安全檢查:');
console.log('  來源塊被排除(不動 Seven陳聖文):', !targets.some((t) => /陳聖文/.test(t.before)));
console.log('  講者對照有被修正:', targets.some((t) => /講者對照/.test(t.before)));
console.log('  混合句對稱交換(其勳要求Seven→Seven要求其勳):', targets.some((t) => /Seven要求其勳|Seven請其勳/.test(t.after)));
if (!WRITE) { console.log('\n(乾跑,未寫入。加 --write 才套用)'); process.exit(0); }
let ok = 0;
for (const t of targets) {
  const body = t.type === 'to_do' ? { to_do: { rich_text: [{ type: 'text', text: { content: t.after.slice(0, 2000) } }], checked: !!t.checked } } : setRT(t.type, t.after);
  await notion(`/v1/blocks/${t.id}`, 'PATCH', body); ok++;
}
console.log(`\n✅ 已更新 ${ok}/${targets.length} 個區塊`);
