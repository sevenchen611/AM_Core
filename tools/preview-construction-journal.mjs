// Local review only: synthetic data, no credentials, no Notion/Drive/network writes.
import http from 'node:http';
import { fixture } from './fixtures/construction-journal-fixture.mjs';
import { submitJournal, handleJournalRequest } from '../modules/construction/journal.js';
import { handleDashboardRequest } from '../modules/construction/dashboard.js';
import { renderJournalPage } from '../modules/construction/journal-page.js';
const f = fixture();
await submitJournal(f.deps, null, f.input);
// Synthetic fixture photo URLs are not real files. Remove them from the preview.
for (const p of f.store.values()) {
  if (p.parent.data_source_id === 'photos') f.store.delete(p.id);
  if (p.properties['原始回報']) {
    const original = JSON.parse(p.properties['原始回報'].rich_text.map(t => t.plain_text).join(''));
    original.entries.forEach(e => { e.photos = []; });
    p.properties['原始回報'].rich_text = [{ plain_text: JSON.stringify(original) }];
  }
}
const port = Number(process.env.JOURNAL_PREVIEW_PORT || 4319);
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/') { res.writeHead(302, { Location: '/journal?tenant=test&project=case-a' }); return res.end(); }
  if (req.method === 'GET' && url.pathname === '/journal') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(renderJournalPage('test', 'case-a', url.searchParams.get('work')).replace('<main>', '<main><p class="error">合成資料示範，非正式工程。請勿輸入正式資料；重啟示範程序後清空。</p><p><a href="/dashboard?tenant=test&previewDoc=work-1">查看原有 work-1 工項下方的施工紀錄 →</a></p>'));
  }
  try {
    if (url.pathname === '/dashboard') {
      const proxy = { writeHead: (...args) => res.writeHead(...args), end: html => res.end(html.replace('</body>', '<script>openDoc("work-1");</script></body>')) };
      return await handleDashboardRequest(req, proxy, url.pathname, url, f.deps);
    }
    if (url.pathname.startsWith('/dashboard/')) return await handleDashboardRequest(req, res, url.pathname, url, f.deps);
    await handleJournalRequest(req, res, url.pathname, url, f.deps);
  } catch { res.writeHead(500); res.end('Preview error'); }
}).listen(port, '127.0.0.1', () => console.log(`Synthetic review only: http://127.0.0.1:${port}/journal?tenant=test&project=case-a`));
