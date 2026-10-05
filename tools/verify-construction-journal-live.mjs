// Explicit live canary: synthetic case only; state stays outside the repository.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { loadTenants, buildDataSourceRegistry } from '../core/tenants.js';
import { createNotion } from '../core/notion.js';
import { createDrive } from '../core/drive.js';
import { queryAll, textFrag, sameId } from '../modules/construction/common.js';
import { projectJournalReport, constructionHistoryForPage } from '../modules/construction/journal.js';
import { uploadJournalPhoto } from '../modules/construction/journal-photos.js';

const [tenantKey, mode, stateArg] = process.argv.slice(2);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!['--prepare', '--verify', '--cleanup'].includes(mode) || !stateArg || !path.isAbsolute(stateArg)) throw Error('Usage: <tenant> --prepare|--verify|--cleanup <absolute-state-outside-repo>');
const statePath = path.resolve(stateArg), relative = path.relative(root, statePath);
if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw Error('State must stay outside AMCore');
const tenants = loadTenants(), tenant = tenants.find(t => t.key === tenantKey);
if (!tenant?.modules.includes('construction')) throw Error('Construction tenant required');
for (const key of ['projects', 'spaces', 'workItems', 'constructionJournals', 'constructionProgress', 'constructionPhotos']) assert.ok(tenant.dataSources[key], `Missing ${key}`);
const notion = createNotion({ token: process.env.NOTION_TOKEN, version: process.env.NOTION_VERSION || '2025-09-03', registry: buildDataSourceRegistry(tenants) });
const request = (p, o = {}) => notion.notionRequest(p, { ...o, tenantKey });
const drive = createDrive({ clientId: process.env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET, refreshToken: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { tenantKey, synthetic: true, pages: [], pending: null };
assert.equal(state.tenantKey, tenantKey); assert.equal(state.synthetic, true);
function save() { fs.mkdirSync(path.dirname(statePath), { recursive: true }); fs.writeFileSync(statePath + '.tmp', JSON.stringify(state), { mode: 0o600 }); fs.renameSync(statePath + '.tmp', statePath); }
const deps = { tenantKey, dataSources: tenant.dataSources, notionRequest: request, actor: '工程日誌部署驗證', access: { user: { role: 'owner' } }, driveConfigured: drive.configured, driveRootFolderId: tenant.driveRootFolderId,
  ensureDriveFolder: async (name, parent) => { const id = await drive.ensureFolder(name, parent); if (name === state.projectId) { state.driveCaseFolder = id; save(); } return id; },
  uploadDriveStream: async (...args) => { const file = await drive.uploadStream(...args); state.driveFileId = file.id; save(); return file; } };

if (mode === '--prepare') {
  if (state.pages.length || state.pending) throw Error('Canary already exists or create outcome unknown; verify/cleanup it before another preparation');
  async function create(key, properties) {
    state.pending = key; save();
    const page = await request('/v1/pages', { method: 'POST', body: { parent: { type: 'data_source_id', data_source_id: tenant.dataSources[key] }, properties } });
    state.pages.push(page.id); state.pending = null; save(); return page.id;
  }
  state.projectId = await create('projects', { '專案名稱': { title: textFrag('工程日誌部署驗證（非施工案件）') }, '館別代碼': { rich_text: textFrag('JRN-QA') } }); save();
  state.spaceId = await create('spaces', { '名稱': { title: textFrag('部署驗證現場（合成）') }, '專案': { relation: [{ id: state.projectId }] } }); save();
  state.secondSpaceId = await create('spaces', { '名稱': { title: textFrag('部署驗證二樓（合成）') }, '專案': { relation: [{ id: state.projectId }] } }); save();
  state.workItemId = await create('workItems', { '工項': { title: textFrag('部署驗證工項（合成）') }, '專案': { relation: [{ id: state.projectId }] }, '空間': { relation: [{ id: state.spaceId }] } }); save();
  state.secondWorkItemId = await create('workItems', { '工項': { title: textFrag('部署驗證第二工項（合成）') }, '專案': { relation: [{ id: state.projectId }] }, '空間': { relation: [{ id: state.secondSpaceId }] } }); save();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');
  state.photo = await uploadJournalPhoto(deps, null, { projectId: state.projectId, date: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10), filename: '部署驗證合成照片.png', contentType: 'image/png', caption: '合成部署測試，非現場照片', stream: Readable.from([png]) });
  state.pages.push(state.photo.id); save();
  assert.ok((await drive.auditPrivateFile(state.driveFileId)).private);
  const downloaded = await drive.download(state.driveFileId); assert.ok(downloaded.buffer.equals(png));
  console.log('CANARY_PROJECT=' + state.projectId);
  console.log(JSON.stringify({ prepared: true, synthetic: true, photoOriginalVerified: true }));
} else if (mode === '--verify') {
  assert.ok(state.projectId); assert.ok(!state.cleaned);
  const report = await projectJournalReport(deps, null, state.projectId);
  const byWork = Boolean(state.secondWorkItemId);
  const first = report.items.find(w => sameId(w.id, state.workItemId));
  assert.equal(report.journals.length, 1); assert.equal(report.journals[0].status, '已更新'); assert.equal(report.journals[0].headcount, byWork ? 9 : 6);
  assert.equal(first.percent, 35); assert.equal(first.records[0].photos.length, 1);
  assert.ok(first.records[0].spaceIds.some(id => sameId(id, state.spaceId)));
  if (byWork) {
    assert.equal(report.journals[0].headcountUnit, '人次');
    assert.equal(first.records[0].headcount, 6); assert.ok(first.records[0].workName);
    assert.ok(first.records[0].spaceIds.some(id => sameId(id, state.secondSpaceId)));
    const second = report.items.find(w => sameId(w.id, state.secondWorkItemId));
    assert.equal(second.records[0].headcount, 3); assert.equal(second.percent, 50);
    const area = await request('/v1/pages/' + state.secondSpaceId, { method: 'GET' });
    assert.equal((await constructionHistoryForPage(deps, null, area)).items.length, 2);
    assert.ok(Object.values(area.properties).some(p => p.type === 'relation' && p.relation.some(r => sameId(r.id, first.records[0].id))), 'Second area reverse relation must contain the actual report');
  }
  const work = await request('/v1/pages/' + state.workItemId, { method: 'GET' });
  const history = await constructionHistoryForPage(deps, null, work); assert.equal(history.items[0].records.length, 1);
  const rawWork = await request('/v1/pages/' + state.workItemId, { method: 'GET' });
  assert.ok(Object.values(rawWork.properties).some(p => p.type === 'relation' && p.relation.some(r => sameId(r.id, history.items[0].records[0].id))), 'Notion reverse relation must point to the actual record');
  state.verified = true; save(); console.log(JSON.stringify({ verified: true, directUpdate: true, headcount: byWork ? 9 : 6, unit: byWork ? '人次' : '人', percent: 35, photos: 1, multiAreaLinked: byWork, engineeringNameSaved: byWork, nativeReverseRelation: true }));
} else {
  if (state.pending) throw Error('Recover unknown create outcome before cleanup');
  assert.ok(state.projectId);
  const rows = [];
  for (const key of ['constructionProgress', 'constructionJournals', 'constructionPhotos']) rows.push(...await queryAll(deps, tenant.dataSources[key], { property: '專案', relation: { contains: state.projectId } }));
  for (const id of [...new Set([...rows.map(p => p.id), ...state.pages])].reverse()) await request('/v1/pages/' + id, { method: 'PATCH', body: { archived: true } });
  if (state.driveCaseFolder) {
    const token = await drive.getAccessToken();
    const response = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(state.driveCaseFolder), { method: 'PATCH', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
    assert.ok(response.ok, 'Synthetic Drive directory must move to recoverable trash');
  }
  state.cleaned = true; save(); console.log(JSON.stringify({ cleaned: true, syntheticNotionPagesArchived: true, syntheticDriveFolderTrashed: Boolean(state.driveCaseFolder) }));
}
