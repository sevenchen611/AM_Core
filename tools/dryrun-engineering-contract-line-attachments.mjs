import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { createContractLineAttachmentService, createContractPublicAttachmentReader } from '../modules/construction/contract-line-attachments.js';
import { createContractWorkflowApiHandler, __test as apiTest } from '../modules/construction/contract-workflow-api.js';
import { createContractSigningWebHandler, CONTRACT_SIGNING_ATTACHMENT_PATH } from '../modules/construction/contract-signing-web.js';

const bytes = Buffer.from('%PDF-fixture');
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
const rich = (value) => [{ plain_text: value }];
const tenant = { key: 'engineering' };
const context = { tenant, actor: 'reviewer', scope: { projectIds: ['project-1'] } };
function fixture() {
  const contract = { id: 'contract-1', projectId: 'project-1', projectCode: 'P1', title: 'Fixture', amount: 100, groupBindingId: 'group-1' };
  const versions = [{ id: 'version-1', contractId: contract.id, versionNo: 1, status: 'frozen', snapshot: {
    templateSource: { templateVersionId: 'template-1' }, documentPackage: { contractFields: { warrantyMonths: 0 }, attachments: [] },
  } }];
  const calls = [];
  let privateFile = true;
  let downloaded = bytes;
  const store = Object.fromEntries(['upsertContract', 'getVersion', 'transitionVersion', 'freezeVersion'].map((name) => [name, async () => null]));
  Object.assign(store, {
    getContract: async (actualTenant) => { assert.equal(actualTenant.key, tenant.key); return structuredClone(contract); },
    listContracts: async () => [structuredClone(contract)],
    listVersions: async () => structuredClone(versions),
    createVersion: async (actualTenant, input) => {
      assert.equal(actualTenant.key, tenant.key);
      assert(!versions.some((version) => version.versionNo === input.versionNo));
      const created = { id: 'version-' + (versions.length + 1), ...structuredClone(input) };
      versions.push(created); return created;
    },
    // Deliberately retain V1 for the public reader even after a new draft exists.
    getSigningBundle: async () => ({ contract: structuredClone(contract), version: { contractSnapshot: versions[0].snapshot } }),
  });
  const message = { id: 'message-1', properties: { '群組綁定': { relation: [{ id: 'group-1' }] }, '發送者': { rich_text: rich('Fixture sender') },
    'LINE 訊息 ID': { rich_text: rich('line-message-1') }, '時間': { date: { start: '2026-09-01T00:00:00Z' } } } };
  const attachment = (id, name, fileId, messageId = message.id) => ({ id, properties: {
    '訊息': { relation: [{ id: messageId }] }, '檔案名稱': { rich_text: rich(name) },
    'Drive 連結': { url: fileId ? 'https://drive.google.com/file/d/' + fileId + '/view' : '' }, '檔案大小': { number: bytes.length },
  } });
  const deps = { tenant, actor: context.actor, contractStore: store, dataSources: { messages: 'messages', attachments: 'attachments' },
    notionRequest: async (path, options) => {
      calls.push({ path, body: options.body });
      if (path.includes('/messages/')) {
        assert.deepEqual(options.body.filter.and[0], { property: '群組綁定', relation: { contains: 'group-1' } });
        return { results: [message, { id: 'foreign-message', properties: { '群組綁定': { relation: [{ id: 'group-other' }] } } }] };
      }
      assert.equal(options.body.filter.or[0].relation.contains, 'message-1');
      return { results: [attachment('attachment-1', '報價單.pdf', 'drive-quote'), attachment('duplicate', 'duplicate.pdf', 'drive-quote'),
        attachment('attachment-2', '施工圖.dwg', 'drive-drawing'), attachment('missing', '未保存.pdf', ''),
        attachment('foreign', 'foreign.pdf', 'drive-foreign', 'foreign-message'), attachment('unsafe', 'unsafe.html', 'drive-unsafe')] };
    },
    auditDrivePrivate: async (id) => { calls.push({ audit: id }); return { private: privateFile }; },
    downloadFromDrive: async (id, max) => { assert(max <= 25 * 1024 * 1024); calls.push({ download: id }); return { buffer: downloaded }; },
  };
  return { deps, calls, versions, service: createContractLineAttachmentService(deps),
    setPrivate: (value) => { privateFile = value; }, setBytes: (value) => { downloaded = value; } };
}
const input = { contractId: 'contract-1', versionId: 'version-1' };
{
  const f = fixture();
  const items = await f.service.listCandidates(context, input);
  assert.equal(items.length, 4); // deduplicated; foreign group/message excluded
  assert(items.every((item) => !('fileId' in item)));
  assert.equal(items.find((item) => item.id === 'missing').available, false);
  assert.equal(items.find((item) => item.id === 'unsafe').available, false);
  await assert.rejects(f.service.listCandidates({ ...context, tenant: { key: 'other' } }, input), { code: 'LINE_ATTACHMENT_TENANT_MISMATCH' });
  const before = f.calls.length;
  await assert.rejects(f.service.listCandidates({ ...context, scope: { projectIds: ['foreign-project'] } }, input));
  assert.equal(f.calls.length, before, 'scope denial must happen before Notion/Drive');
  await assert.rejects(f.service.loadCandidate(context, { ...input, attachmentId: 'foreign' }), { code: 'LINE_ATTACHMENT_NOT_FOUND' });
  f.setPrivate(false);
  await assert.rejects(f.service.loadCandidate(context, { ...input, attachmentId: 'attachment-1' }), { code: 'LINE_ATTACHMENT_NOT_PRIVATE' });
  f.setPrivate(true);
  const original = structuredClone(f.versions[0]);
  const result = await f.service.importCandidates(context, { ...input, selections: [{ id: 'attachment-1', category: 'quotation' }, { id: 'attachment-2', category: 'construction_drawing' }] });
  assert.equal(result.version.versionNo, 2);
  assert.equal(result.version.status, 'draft');
  assert.deepEqual(f.versions[0], original, 'frozen source is immutable');
  const pkg = result.version.documentPackage;
  assert.equal(pkg.quotation.sha256, sha256);
  assert.equal(pkg.constructionDrawings[0].mimeType, 'application/acad');
  assert.equal(pkg.quotation.sourceEvidence.messageId, 'line-message-1');
  assert.equal(pkg.contractFields.warrantyMonths, 0);
  assert.equal(result.version.snapshot.templateSource.templateVersionId, 'template-1');
  await assert.rejects(f.service.importCandidates(context, { ...input, selections: [{ id: 'attachment-1' }] }), { code: 'LINE_ATTACHMENT_STALE_VERSION' });
  const newer = { ...input, versionId: result.version.id };
  assert.equal((await f.service.listCandidates(context, newer)).find((item) => item.id === 'attachment-1').included, true);
  await assert.rejects(f.service.importCandidates(context, { ...newer, selections: [{ id: 'attachment-1' }] }), { code: 'LINE_ATTACHMENT_ALREADY_INCLUDED' });
  const reader = createContractPublicAttachmentReader(f.deps);
  const opened = { sessionId: 'session-1', contractId: 'contract-1', projectId: 'project-1' };
  assert.deepEqual(await reader.list(opened), [], 'new internal draft must not leak through issued V1 link');
  f.versions[0].snapshot.documentPackage.attachments.push({ name: 'quote.pdf', category: 'quotation', fileId: 'drive-quote', sha256 });
  const publicItems = await reader.list(opened);
  assert.deepEqual(publicItems, [{ id: '0', name: 'quote.pdf', category: 'quotation' }]);
  assert.deepEqual((await reader.load(opened, { attachmentId: '0' })).buffer, bytes);
  await assert.rejects(reader.list({ ...opened, contractId: 'foreign' }), { code: 'CONTRACT_ATTACHMENT_BUNDLE_MISMATCH' });
  f.setBytes(Buffer.from('changed'));
  await assert.rejects(reader.load(opened, { attachmentId: '0' }), { code: 'CONTRACT_ATTACHMENT_HASH_MISMATCH' });
}
{
  const f = fixture();
  f.versions[0].snapshot.attachmentExclusions = ['file:drive-quote'];
  assert.equal((await f.service.listCandidates(context, input)).find((item) => item.id === 'attachment-1').available, false);
  await assert.rejects(f.service.importCandidates(context, { ...input, selections: [{ id: 'attachment-1' }] }), { code: 'LINE_ATTACHMENT_UNAVAILABLE' });
  await assert.rejects(f.service.importCandidates(context, { ...input, selections: [{ id: 'attachment-2', category: 'contract_body' }] }), { code: 'LINE_ATTACHMENT_CATEGORY_INVALID' });
  assert.equal(f.versions.length, 1);
}
const base = '/contracts/api/v2/contracts/contract-1/versions/version-1/line-attachments';
{
  const f = fixture();
  f.versions[0].snapshot.documentPackage.attachments = [{ fileId: 'drive-quote', name: '報價單.pdf', sha256, category: 'quotation', inherited: true }];
  const imported = await f.service.importCandidates(context, { ...input, selections: [{ id: 'attachment-1', category: 'quotation' }] });
  assert.equal(imported.version.documentPackage.quotation.fileId, 'drive-quote');
  assert.equal((imported.version.documentPackage.attachments || []).filter((item) => item.fileId === 'drive-quote').length, 0, 'promoting a historical file must not duplicate it');
}
{
  const f = fixture();
  const originalQuery = f.deps.notionRequest;
  let paged = false;
  f.deps.notionRequest = async (path, options) => {
    const result = await originalQuery(path, options);
    if (path.includes('/attachments/') && !options.body.start_cursor) return { ...result, has_more: true, next_cursor: 'page-2' };
    if (options.body.start_cursor) { assert.equal(options.body.start_cursor, 'page-2'); paged = true; }
    return result;
  };
  assert.equal((await f.service.listCandidates(context, input)).length, 4);
  assert.equal(paged, true);
  await assert.rejects(f.service.importCandidates(context, { ...input, selections: [{ id: 'attachment-1' }, { id: 'missing' }] }), { code: 'LINE_ATTACHMENT_UNAVAILABLE' });
  assert.equal(f.versions.length, 1, 'a failing selection must not create a partial version');
}
assert.equal(apiTest.routeFor('GET', base).capability, 'view');
assert.equal(apiTest.routeFor('POST', base).capability, 'manage');
assert.equal(apiTest.routeFor('GET', base + '/attachment-1').binary, true);
{
  const f = fixture();
  const handler = createContractWorkflowApiHandler(f.deps);
  const req = Readable.from([JSON.stringify({ selections: [{ id: 'attachment-1' }], capabilities: { manage: true } })]); req.method = 'POST';
  const res = { writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
  await handler(req, res, base, new URL(base, 'https://example.test'), { scope: context.scope, capabilities: { view: true, manage: false } });
  assert.equal(res.status, 403); assert.equal(f.calls.length, 0);
}
{
  let verified = 0;
  let loaded = 0;
  const handler = createContractSigningWebHandler({ liffId: 'fixture-liff',
    service: { openSigningRequest: async ({ token, liffCredential }) => { verified++; assert.equal(token, 'token-1'); assert.equal(liffCredential, 'credential-1'); return { sessionId: 'session-1' }; }, submitSignature: async () => ({}), submitPartyASignature: async () => ({}) },
    loadDocument: async () => ({}), saveSignature: async () => ({}), saveIdentityDocuments: async () => ({}),
    loadAttachment: async (opened, selected) => { loaded++; assert.equal(opened.sessionId, 'session-1'); assert.equal(selected.attachmentId, '0'); return { buffer: bytes, mimeType: 'application/pdf', fileName: '附件.pdf' }; },
  });
  const req = Readable.from([JSON.stringify({ token: 'token-1', liffCredential: 'credential-1', attachmentId: '0' })]); req.method = 'POST'; req.headers = { 'content-type': 'application/json' }; req.socket = {};
  const res = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
  await handler(req, res, CONTRACT_SIGNING_ATTACHMENT_PATH, new URL(CONTRACT_SIGNING_ATTACHMENT_PATH, 'https://example.test'));
  assert.equal(res.status, 200); assert.equal(verified, 1); assert.equal(loaded, 1); assert.deepEqual(res.body, bytes);
  assert(res.headers['Content-Disposition'].includes(encodeURIComponent('附件.pdf')));
}
console.log('Engineering LINE contract attachments: PASS (scope, provenance, deduplication, immutable next version, privacy, public frozen-version reads and SHA-256).');
