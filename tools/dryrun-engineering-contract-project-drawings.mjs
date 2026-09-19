import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { createContractProjectDrawingService, __test } from '../modules/construction/contract-project-drawings.js';
import { createContractWorkflowApiHandler, __test as apiTest } from '../modules/construction/contract-workflow-api.js';

const bytes = Buffer.from('%PDF-stage-one-drawing');
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
const tenant = { key: 'engineering' };
const context = { tenant, actor: '工程管理者', scope: { projectIds: ['project-1'] } };
const rich = (value) => [{ plain_text: value }];

function fixture() {
  const contract = { id: 'contract-1', projectId: 'project-1', projectCode: 'CAOWU', title: '草悟道工程合約', amount: 100 };
  const versions = [{ id: 'version-1', contractId: contract.id, versionNo: 1, status: 'draft', documentPackage: {
    contractFields: { projectName: '草悟道案場', contractAmount: 100 }, constructionDrawings: [],
  } }];
  const calls = [];
  let privateFile = true;
  let downloaded = bytes;
  let drawingName = '一樓施工定版圖.pdf';
  const store = Object.fromEntries(['upsertContract', 'getVersion', 'transitionVersion', 'freezeVersion'].map((name) => [name, async () => null]));
  Object.assign(store, {
    getContract: async () => structuredClone(contract),
    listContracts: async () => [structuredClone(contract)],
    listVersions: async () => structuredClone(versions),
    createVersion: async (_tenant, input) => {
      const created = { id: `version-${versions.length + 1}`, ...structuredClone(input) };
      versions.push(created);
      return created;
    },
  });
  const drawing = (id, projectId, options = {}) => ({
    id, created_time: options.uploadedAt || '2026-09-18T08:00:00Z',
    properties: {
      '專案': { relation: [{ id: projectId }] },
      '圖面': { title: rich(options.drawingName || '一樓施工圖') },
      '版本': { rich_text: rich(options.version || 'V5 定版') },
      '狀態': { select: { name: options.status || '定版' } },
      '原始檔名': { rich_text: rich(options.fileName || drawingName) },
      'Drive 檔案 ID': { rich_text: rich(options.fileId === undefined ? 'drive-stage-one-v5' : options.fileId) },
      'Drive 連結': { url: 'https://drive.google.com/file/d/private/view' },
      '檔案類型': { rich_text: rich(options.mimeType || 'application/pdf') },
      '檔案大小': { number: options.size === undefined ? bytes.length : options.size },
      '版本說明': { rich_text: rich('審圖完成') },
      '上傳者': { rich_text: rich('設計部') },
      '上傳時間': { date: { start: options.uploadedAt || '2026-09-18T08:00:00Z' } },
    },
  });
  const deps = {
    tenant, actor: context.actor, contractStore: store, dataSources: { designDrawings: 'drawing-source' },
    notionRequest: async (path, options = {}) => {
      calls.push({ path, options });
      if (path === '/v1/pages/project-1') return { properties: { '專案名稱': { type: 'title', title: rich('草悟道案場') } } };
      if (path.includes('/data_sources/drawing-source/query')) {
        assert.deepEqual(options.body.filter, { property: '專案', relation: { contains: 'project-1' } });
        return { results: [
          drawing('drawing-v5', 'project-1'),
          drawing('drawing-void', 'project-1', { status: '作廢', fileName: '已作廢.pdf', fileId: 'drive-void' }),
          drawing('drawing-large', 'project-1', { fileName: '超大圖.pdf', fileId: 'drive-large', size: 26 * 1024 * 1024 }),
          drawing('foreign', 'project-2', { fileName: '別案圖.pdf', fileId: 'drive-foreign' }),
          { ...drawing('archived', 'project-1', { fileName: '已封存.pdf', fileId: 'drive-archived' }), archived: true },
        ] };
      }
      throw new Error(`unexpected Notion request ${path}`);
    },
    auditDrivePrivate: async (fileId) => { calls.push({ audit: fileId }); return { private: privateFile }; },
    downloadFromDrive: async (fileId, maxBytes) => {
      assert.equal(fileId, 'drive-stage-one-v5');
      assert.equal(maxBytes, 25 * 1024 * 1024);
      calls.push({ download: fileId });
      return { buffer: downloaded };
    },
  };
  return {
    deps, calls, versions, service: createContractProjectDrawingService(deps),
    rename: (value) => { drawingName = value; },
    setPrivate: (value) => { privateFile = value; },
    setBytes: (value) => { downloaded = value; },
  };
}

{
  const f = fixture();
  const rows = await f.service.listCandidates(context, { contractId: 'contract-1' });
  assert.equal(rows.length, 3, 'foreign project rows must be filtered even if Notion returns them');
  assert(rows.every((row) => !('fileId' in row) && !('projectId' in row)), 'storage identifiers stay server-side');
  assert.equal(rows.find((row) => row.id === 'drawing-v5').available, true);
  assert.equal(rows.find((row) => row.id === 'drawing-void').available, false);
  assert.match(rows.find((row) => row.id === 'drawing-large').reason, /25 MB/);
  assert.equal(rows[0].projectName, '草悟道案場');
  await assert.rejects(f.service.listCandidates({ ...context, tenant: { key: 'other' } }, { contractId: 'contract-1' }), { code: 'PROJECT_DRAWING_TENANT_MISMATCH' });
  const before = f.calls.length;
  await assert.rejects(f.service.listCandidates({ ...context, scope: { projectIds: ['project-2'] } }, { contractId: 'contract-1' }));
  assert.equal(f.calls.length, before, 'scope denial happens before Notion/Drive access');
  await assert.rejects(f.service.loadCandidate(context, { contractId: 'contract-1', drawingId: 'foreign' }), { code: 'PROJECT_DRAWING_NOT_FOUND' });
  f.setPrivate(false);
  await assert.rejects(f.service.loadCandidate(context, { contractId: 'contract-1', drawingId: 'drawing-v5' }), { code: 'PROJECT_DRAWING_NOT_PRIVATE' });
}

{
  const f = fixture();
  const sourcePackage = structuredClone(f.versions[0].documentPackage);
  const resolved = await f.service.resolveSelections(context, {
    contractId: 'contract-1', sourceVersionId: 'version-1', selections: ['drawing-v5', 'drawing-v5'], documentPackage: sourcePackage,
  });
  assert.equal(resolved.documentPackage.constructionDrawings.length, 1, 'duplicate selections are deduplicated');
  const attachment = resolved.documentPackage.constructionDrawings[0];
  assert.equal(attachment.fileId, 'drive-stage-one-v5', 'the original private file is referenced, not copied');
  assert.equal(attachment.sha256, sha256);
  assert.equal(attachment.sizeBytes, bytes.length);
  assert.equal(attachment.revision, 'V5 定版');
  assert.equal(attachment.sourceEvidence.source, __test.SOURCE);
  assert.equal(attachment.sourceEvidence.sourceProjectId, 'project-1');
  assert.equal(attachment.sourceEvidence.sourceProjectName, '草悟道案場');
  assert.equal(attachment.sourceEvidence.sourceStage, __test.SOURCE_STAGE);
  assert.equal(attachment.sourceEvidence.snapshot.sha256, sha256);
  f.rename('後來改名.pdf');
  assert.equal(attachment.name, '一樓施工定版圖.pdf', 'saved snapshot name remains immutable after library rename');
  assert.deepEqual(sourcePackage.constructionDrawings, [], 'input package is not mutated');
  await assert.rejects(f.service.resolveSelections(context, {
    contractId: 'contract-1', selections: ['drawing-void'], documentPackage: sourcePackage,
  }), { code: 'PROJECT_DRAWING_UNAVAILABLE' });
  f.versions.push({ id: 'version-2', contractId: 'contract-1', versionNo: 2, status: 'draft', documentPackage: sourcePackage });
  await assert.rejects(f.service.resolveSelections(context, {
    contractId: 'contract-1', sourceVersionId: 'version-1', selections: ['drawing-v5'], documentPackage: sourcePackage,
  }), { code: 'PROJECT_DRAWING_STALE_CONTRACT_VERSION' });
}

const base = '/contracts/api/v2/contracts/contract-1/project-drawings';
assert.equal(apiTest.routeFor('GET', base).capability, 'view');
assert.equal(apiTest.routeFor('GET', `${base}/drawing-v5`).binary, true);
assert.equal(apiTest.routeFor('POST', base).methodNotAllowed, true);

const workspaceSource = fs.readFileSync(new URL('../modules/construction/contracts.js', import.meta.url), 'utf8');
assert.match(workspaceSource, /從工程圖庫選擇施工圖/);
assert.match(workspaceSource, /projectDrawingSelections:PROJECT_DRAWING_PICKER\.selected/);
assert.match(workspaceSource, /id="wf-file-'\+kind\+'"/, 'existing direct upload stays available');
assert.match(workspaceSource, /階段一圖庫/);

{
  const f = fixture();
  const handler = createContractWorkflowApiHandler(f.deps);
  const requestBody = {
    documentPackage: { contractFields: { projectName: '草悟道案場', contractAmount: 100 }, constructionDrawings: [] },
    projectDrawingSelections: ['drawing-v5'],
    sourceVersionId: 'version-1',
  };
  const req = Readable.from([Buffer.from(JSON.stringify(requestBody))]);
  req.method = 'POST'; req.headers = {};
  const res = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
  const path = '/contracts/api/v2/contracts/contract-1/versions';
  await handler(req, res, path, new URL(path, 'https://example.test'), {
    scope: context.scope, capabilities: { manage: true, view: true },
  });
  assert.equal(res.status, 200);
  const saved = f.versions.at(-1);
  assert.equal(saved.versionNo, 2);
  assert.equal(saved.documentPackage.constructionDrawings[0].sha256, sha256);
  assert.equal(saved.snapshot.projectDrawingSelection.drawings[0].drawingVersionId, 'drawing-v5');
  assert.equal(saved.snapshot.documentPackage.constructionDrawings[0].fileId, 'drive-stage-one-v5');
}

console.log('Engineering contract project drawings: PASS (tenant/project scope, stage-one selection, private preview, immutable metadata/hash snapshot, no-copy reference and API save).');
