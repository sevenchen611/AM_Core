import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { handleTaskCardRequest, renderTaskCardPage } from '../modules/construction/task-card.js';
import { handleDashboardRequest } from '../modules/construction/dashboard.js';

const taskId = '3b351c68-6dac-8165-b61d-f23a48367e76';
const projectId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const taskPage = {
  id: taskId,
  parent: { data_source_id: 'tasks-ds' },
  created_time: '2026-08-06T01:00:00.000Z',
  last_edited_time: '2026-08-06T02:00:00.000Z',
  properties: {
    '內容': { type: 'title', title: [{ plain_text: '準備國稅局訪查相關文件' }] },
    '狀態': { type: 'select', select: { name: '待辦' } },
    '負責人': { type: 'rich_text', rich_text: [{ plain_text: '昱晴 Maggie' }] },
    '期限': { type: 'date', date: { start: '2026-08-06' } },
    '來源': { type: 'select', select: { name: '會議' } },
    '來源證據': { type: 'rich_text', rich_text: [] },
    '專案': { type: 'relation', relation: [{ id: projectId }] },
  },
};

const calls = [];
const deps = {
  tenantKey: 'engineering',
  actor: '測試同仁',
  dataSources: { tasks: 'tasks-ds' },
  async uploadFileToNotion(buffer, name, type) {
    calls.push({ kind: 'upload', size: buffer.length, name, type });
    return { id: 'upload-1' };
  },
  async notionRequest(pathname, options = {}) {
    calls.push({ kind: 'notion', pathname, options });
    if (pathname === `/v1/pages/${encodeURIComponent(taskId)}` && options.method === 'GET') return taskPage;
    if (pathname === `/v1/pages/${encodeURIComponent(projectId)}` && options.method === 'GET') {
      return { properties: { '專案名稱': { type: 'title', title: [{ plain_text: '草悟道館' }] } } };
    }
    if (pathname === '/v1/data_sources/tasks-ds' && options.method === 'GET') {
      return { properties: { '狀態': { select: { options: ['待辦', '進行中', '完成', '取消'].map((name) => ({ name })) } } } };
    }
    if (pathname.startsWith(`/v1/blocks/${encodeURIComponent(taskId)}/children?`) && options.method === 'GET') {
      return { results: [
        { id: 'b1', type: 'paragraph', paragraph: { rich_text: [{ plain_text: '來源證據：來自 8/6 工程會議' }] } },
        { id: 'b2', type: 'heading_3', heading_3: { rich_text: [{ plain_text: '[處理紀錄] 開始整理文件' }] } },
      ], has_more: false };
    }
    if (pathname === `/v1/blocks/${encodeURIComponent(taskId)}/children` && options.method === 'PATCH') return { ok: true };
    if (pathname === `/v1/pages/${encodeURIComponent(taskId)}` && options.method === 'PATCH') return { ok: true };
    throw new Error(`Unexpected Notion call: ${options.method} ${pathname}`);
  },
};

function responseCapture() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers || {}; },
    end(body = '') { this.body = String(body); },
  };
}

const legacyRes = responseCapture();
await handleDashboardRequest(
  { method: 'GET' },
  legacyRes,
  '/dashboard',
  new URL(`https://am.example/dashboard?tenant=engineering&doc=${taskId}`),
  { tenantKey: 'engineering' },
);
assert.equal(legacyRes.status, 302);
assert.equal(legacyRes.headers.Location, `/task?tenant=engineering&doc=${encodeURIComponent(taskId)}`);

const html = renderTaskCardPage('engineering', taskId);
assert.match(html, /新增處理紀錄/);
assert.match(html, /\/dashboard\?tenant=engineering/);
assert.match(html, /\/task\/api\/update/);
const clientScript = html.match(/<script>([\s\S]*)<\/script>/)?.[1] || '';
assert.ok(clientScript, 'task card should contain its client script');
new Function(clientScript); // compile only; browser globals are not executed

const getRes = responseCapture();
await handleTaskCardRequest(
  { method: 'GET' },
  getRes,
  '/task/api/card',
  new URL(`https://am.example/task/api/card?tenant=engineering&page=${taskId}`),
  deps,
);
assert.equal(getRes.status, 200);
const card = JSON.parse(getRes.body);
assert.equal(card.title, '準備國稅局訪查相關文件');
assert.equal(card.project, '草悟道館');
assert.equal(card.sourceEvidence, '來自 8/6 工程會議');
assert.equal(card.history.length, 1);
assert.equal(card.history[0].spans[0].text, '[處理紀錄] 開始整理文件');

const payload = JSON.stringify({
  page: taskId,
  status: '完成',
  note: '已整理公司關係說明與二樓辦公室證明。',
  images: [{ name: 'result.png', type: 'image/png', data: Buffer.from('fake-png').toString('base64') }],
});
const postReq = Readable.from([Buffer.from(payload)]);
postReq.method = 'POST';
const postRes = responseCapture();
await handleTaskCardRequest(
  postReq,
  postRes,
  '/task/api/update',
  new URL('https://am.example/task/api/update?tenant=engineering'),
  deps,
);
assert.equal(postRes.status, 200);
assert.equal(JSON.parse(postRes.body).status, '完成');
assert.equal(calls.filter((call) => call.kind === 'upload').length, 1);
const append = calls.find((call) => call.kind === 'notion' && call.pathname === `/v1/blocks/${encodeURIComponent(taskId)}/children` && call.options.method === 'PATCH');
assert.ok(append);
assert.ok(append.options.body.children.some((block) => block.type === 'image'));
const statusPatch = calls.find((call) => call.kind === 'notion' && call.pathname === `/v1/pages/${encodeURIComponent(taskId)}` && call.options.method === 'PATCH');
assert.equal(statusPatch.options.body.properties['狀態'].select.name, '完成');

console.log(JSON.stringify({ ok: true, cardFields: Object.keys(card).length, historyBlocks: card.history.length, uploads: 1 }));
