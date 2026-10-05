import { fixture } from './fixtures/construction-journal-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { Readable } from 'node:stream';
import construction from '../modules/construction/index.js';
import { submitJournal, confirmJournal, voidJournal, projectJournalReport, constructionHistoryForPage, journalOptions, handleJournalRequest, __test } from '../modules/construction/journal.js';
import { handleDashboardRequest } from '../modules/construction/dashboard.js';
import { renderJournalPage } from '../modules/construction/journal-page.js';
import { uploadJournalPhoto } from '../modules/construction/journal-photos.js';
import { journalSchemas } from '../versions/AM-IMP-2026.1005.01/schemas/journal-schema.js';


test('member submission directly updates progress and links source, crew and site without approval', async () => {
  const f = fixture(); f.deps.access = { user: { role: 'member' } };
  const result = await submitJournal(f.deps, null, f.input);
  assert.equal(result.journal.headcount, 4);
  assert.equal(result.journal.status, '已更新');
  assert.equal(result.journal.reviewer, '');
  const after = await projectJournalReport(f.deps, null, 'case-a');
  assert.equal(after.items[0].percent, 20); assert.equal(after.items[1].percent, 40);
  assert.equal(after.items[0].records[0].journalId, result.journal.id);
  assert.equal(after.items[0].records[0].photos.length, 1);
  assert.deepEqual(after.items[0].records[0].spaceIds, ['space-a']);
  assert.equal(after.items[0].records[0].crewCount, 4);
  assert.equal(f.store.get('work-1').properties['狀態'], undefined);
});
test('retry and concurrent duplicates create one master and one row per item', async () => {
  const f = fixture(); await Promise.all([submitJournal(f.deps, null, f.input), submitJournal(f.deps, null, f.input)]);
  await submitJournal(f.deps, null, f.input);
  assert.equal([...f.store.values()].filter(p => p.parent.data_source_id === 'journals').length, 1);
  assert.equal([...f.store.values()].filter(p => p.parent.data_source_id === 'progress').length, 2);
  await assert.rejects(submitJournal(f.deps, null, { ...f.input, summary: '不同內容' }), /不同內容/);
});
test('interrupted index construction preserves original source and recovers missing rows only', async () => {
  const f = fixture(); f.failAt(3);
  await assert.rejects(submitJournal(f.deps, null, f.input), /transient/);
  const hidden = await projectJournalReport(f.deps, null, 'case-a');
  assert.equal(hidden.items[0].records.length, 0);
  const master = [...f.store.values()].find(p => p.parent.data_source_id === 'journals');
  assert.ok(master.properties['原始回報'].rich_text[0].plain_text.includes('合成施工內容'));
  f.failAt(Infinity); await submitJournal(f.deps, null, f.input);
  assert.equal([...f.store.values()].filter(p => p.parent.data_source_id === 'progress').length, 2);
});
test('tenant, project, budget and confirmation scope enforced before any write', async () => {
  for (const workItemId of ['work-b', 'work-other-tenant']) {
    const f = fixture(); f.input.entries[0].workItemId = workItemId;
    await assert.rejects(submitJournal(f.deps, null, f.input), /不屬於/); assert.equal(f.writes(), 0);
  }
  const f = fixture(); await assert.rejects(submitJournal(f.deps, new Set(['B']), f.input), /權限/);
  f.input.entries[0].budgetId = 'budget-1'; await assert.rejects(submitJournal(f.deps, null, f.input), /無預算/); assert.equal(f.writes(), 0);
  delete f.input.entries[0].budgetId; const j = await submitJournal(f.deps, null, f.input);
  await assert.rejects(confirmJournal({ ...f.deps, access: { user: { role: 'member' } } }, null, { journalId: j.journal.id, note: 'test' }), /管理者/);
  await assert.rejects(projectJournalReport(f.deps, new Set(), 'case-a'), /權限/);
});
test('invalid inputs, dates, quantities and missing imported evidence are refused', async () => {
  for (const mutate of [i => i.date = '2026-02-30', i => i.crews[0].count = -1, i => i.entries[0].percent = 101,
    i => i.entries[0].quantity = '5', i => i.entries[0].unit = '', i => i.entries[0].crewId = 'missing',
    i => i.source = { kind: 'line' }, i => i.entries[1].workItemId = 'work-1', i => i.noWork = true]) {
    const f = fixture(); mutate(f.input); await assert.rejects(submitJournal(f.deps, null, f.input)); assert.equal(f.writes(), 0);
  }
  assert.throws(() => __test.dateOnly('nonsense'));
});
test('unknown headcount is null; known zero and no-work day are valid', async () => {
  const f = fixture(); f.input.crews[0].count = null;
  assert.equal((await submitJournal(f.deps, null, f.input)).journal.headcount, null);
  const z = fixture(); z.input.crews = []; z.input.entries = []; z.input.noWork = true;
  assert.equal((await submitJournal(z.deps, null, z.input)).journal.headcount, 0);
});
test('repeated crew name and trade cannot inflate daily headcount', async () => {
  const f = fixture(); f.input.crews.push({ ...f.input.crews[0], id: 'another-row' });
  await assert.rejects(submitJournal(f.deps, null, f.input), /同一工班/);
  assert.equal(f.writes(), 0);
});
test('overlong source and execution evidence are rejected rather than silently truncated', async () => {
  for (const mutate of [i => { i.source = { kind: 'report', reference: 'synthetic-source', original: 'x'.repeat(8001) }; },
    i => { i.source.reference = 'x'.repeat(1001); }, i => { i.entries[0].blocker = 'x'.repeat(1901); },
    i => { i.entries[0].nextStep = 'x'.repeat(1901); }, i => { i.entries[0].photos[0].caption = 'x'.repeat(501); }]) {
    const f = fixture(); mutate(f.input); await assert.rejects(submitJournal(f.deps, null, f.input), /上限/); assert.equal(f.writes(), 0);
  }
  const f = fixture(); f.input.source = { kind: 'report', reference: 'synthetic-source', original: 'x'.repeat(8000) };
  await submitJournal(f.deps, null, f.input);
  assert.equal((await projectJournalReport(f.deps, null, 'case-a')).journals[0].original.source.original.length, 8000);
});
test('backfill preserves latest work date; latest same-day submission supersedes and retains earlier records', async () => {
  const f = fixture(); const j = await submitJournal(f.deps, null, f.input);
  await confirmJournal(f.deps, null, { journalId: j.journal.id, note: 'test' });
  const old = structuredClone(f.input); old.requestId = 'old'; old.date = '2026-10-01'; old.entries[0].percent = 5;
  const oldJ = await submitJournal(f.deps, null, old); await confirmJournal(f.deps, null, { journalId: oldJ.journal.id, note: 'old' });
  assert.equal((await projectJournalReport(f.deps, null, 'case-a')).items[0].percent, 20);
  const conflict = structuredClone(f.input); conflict.requestId = 'conflict'; conflict.entries[0].percent = 30;
  const c = await submitJournal(f.deps, null, conflict); await confirmJournal(f.deps, null, { journalId: c.journal.id, note: 'different' });
  const report = await projectJournalReport(f.deps, null, 'case-a');
  assert.equal(report.items[0].conflict, false); assert.equal(report.items[0].percent, 30);
  assert.deepEqual(report.items[0].records.map(r => r.percent), [30, 20, 5]);
});
test('financial options stay hidden unless separately authorized', async () => {
  const f = fixture(); const opts = await journalOptions(f.deps, null, 'case-a'); assert.equal(opts.budgets.length, 0);
  assert.equal((await journalOptions(f.deps, null, 'case-a', { canBudget: true })).budgets.length, 1);
});
test('voiding excludes erroneous progress while preserving source and approval evidence', async () => {
  const f = fixture(), j = await submitJournal(f.deps, null, f.input);
  // A legacy pending journal can still be reviewed; new submissions bypass this path.
  await f.deps.notionRequest('/v1/pages/' + j.journal.id, { method: 'PATCH', body: { properties: { '狀態': { select: { name: '待確認' } } } } });
  await confirmJournal(f.deps, null, { journalId: j.journal.id, note: 'original review' });
  await voidJournal(f.deps, null, { journalId: j.journal.id, note: 'reported wrong quantity' });
  const repeated = await voidJournal({ ...f.deps, actor: 'another-owner' }, null, { journalId: j.journal.id, note: 'later overwrite attempt' });
  assert.equal(repeated.replay, true);
  const r = await projectJournalReport(f.deps, null, 'case-a');
  assert.equal(r.items[0].records.length, 0); assert.equal(r.journals[0].reviewNote, 'original review');
  assert.equal(r.journals[0].original.crews[0].count, 4); assert.equal(r.journals[0].voidReason, 'reported wrong quantity');
  assert.equal(r.journals[0].voidedBy, 'test-owner');
});

test('original work and site pages contain only their related history with permission guards', async () => {
  const f = fixture(); f.input.entries[0].budgetId = 'budget-1';
  await submitJournal(f.deps, null, f.input, { canBudget: true });
  const work = await constructionHistoryForPage(f.deps, null, f.store.get('work-1'));
  assert.deepEqual(work.items.map(w => w.id), ['work-1']);
  assert.equal(work.items[0].records[0].source.kind, 'web');
  assert.ok(work.journalUrl.endsWith('&work=work-1'));
  const site = await constructionHistoryForPage(f.deps, null, f.store.get('space-a'));
  assert.equal(site.items.length, 2);
  const emptySite = await constructionHistoryForPage(f.deps, null, f.store.get('space-other'));
  assert.equal(emptySite.items.length, 0);
  await assert.rejects(constructionHistoryForPage(f.deps, new Set(['B']), f.store.get('work-1')), /權限/);
  await assert.rejects(constructionHistoryForPage(f.deps, null, f.store.get('budget-1')), /預算/);
  const budget = await constructionHistoryForPage(f.deps, null, f.store.get('budget-1'), { canBudget: true });
  assert.deepEqual(budget.items.map(w => w.id), ['work-1']);
  for (const spaceId of ['space-other', 'space-b']) {
    const invalid = fixture(); invalid.input.entries[0].spaceId = spaceId;
    await assert.rejects(submitJournal(invalid.deps, null, invalid.input), /空間/);
    assert.equal(invalid.writes(), 0);
  }
});

test('dashboard doc API supplies history below original content and browser script compiles', async () => {
  const f = fixture(); await submitJournal(f.deps, null, f.input);
  const res = { setHeader() {}, writeHead(n) { this.status = n; }, end(s) { this.body = s; } };
  await handleDashboardRequest({ method: 'GET' }, res, '/dashboard/api/doc', new URL('http://local/dashboard/api/doc?page=work-1'), f.deps);
  const doc = JSON.parse(res.body);
  assert.equal(doc.constructionHistory.items[0].percent, 20);
  assert.equal(doc.constructionHistory.items.length, 1);
  await handleDashboardRequest({ method: 'GET' }, res, '/dashboard', new URL('http://local/dashboard'), f.deps);
  new vm.Script(res.body.match(/<script>([\s\S]*?)<\/script>/)[1]);
  assert.ok(res.body.includes('施工日誌與進度紀錄'));
  const form = renderJournalPage('test', 'case-a', 'work-1');
  assert.ok(form.includes('提交日誌，直接更新進度'));
  assert.ok(!form.includes('data-confirm'));
  assert.equal(journalSchemas(f.deps.dataSources).constructionProgress.properties['空間'].relation.data_source_id, 'spaces');
});
test('photo uploads verify scope and image bytes, and archive only under the case directory', async () => {
  const f = fixture(), folders = []; let uploaded = false;
  const deps = { ...f.deps, driveConfigured: true, driveRootFolderId: 'synthetic-root',
    ensureDriveFolder: async (name, parent) => { folders.push([name, parent]); return 'f-' + folders.length; },
    uploadDriveStream: async () => { uploaded = true; return { id: 'synthetic-photo' }; } };
  const input = { projectId: 'case-a', date: '2026-10-05', filename: 'sample.png', contentType: 'image/png' };
  await assert.rejects(uploadJournalPhoto(deps, new Set(['B']), { ...input, stream: Readable.from([Buffer.alloc(8)]) }), /權限/);
  await assert.rejects(uploadJournalPhoto(deps, null, { ...input, stream: Readable.from([Buffer.from('<svg>')]) }), /JPEG/);
  assert.equal(uploaded, false);
  const photo = await uploadJournalPhoto(deps, null, { ...input, stream: Readable.from([Buffer.from([137,80,78,71,13,10,26,10])]) });
  assert.equal(photo.kind, 'photo'); assert.equal(folders[1][0], 'case-a');
});
test('HTML inline script compiles and untrusted boot value cannot close script', () => {
  const html = renderJournalPage('test', '</script><script>bad()');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  new vm.Script(script); assert.ok(!html.includes('</script><script>bad()'));
  assert.ok(construction.routes.some(r => r.prefix === '/journal' && r.access.capability === 'construction.read'));
  assert.equal(typeof construction.routes.find(r => r.prefix === '/journal').handler, 'function');
  const ids = fixture().deps.dataSources, schemas = journalSchemas(ids);
  assert.equal(schemas.constructionProgress.properties['日誌'].relation.data_source_id, ids.constructionJournals);
});
test('API rejects malformed JSON and enforces scoped project listing', async () => {
  const f = fixture(); function response() { return { status: 0, setHeader() {}, writeHead(n) { this.status = n; }, end(s) { this.body = JSON.parse(s); } }; }
  const res = response();
  await handleJournalRequest(Readable.from([Buffer.from('{bad')]), res, '/journal/api/submit', new URL('http://local/journal/api/submit'), f.deps);
  // Readable stream needs an HTTP method to enter the POST handler.
  const req = Readable.from([Buffer.from('{bad')]); req.method = 'POST';
  await handleJournalRequest(req, res, '/journal/api/submit', new URL('http://local/journal/api/submit'), f.deps); assert.equal(res.status, 400);
  const get = { method: 'GET' };
  await handleJournalRequest(get, res, '/journal/api/projects', new URL('http://local/journal/api/projects?scope=A'), f.deps);
  assert.deepEqual(res.body.projects.map(p => p.id), ['case-a']);
});
