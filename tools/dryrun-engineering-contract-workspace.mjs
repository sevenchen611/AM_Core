import assert from 'node:assert/strict';
import { handleContractsRequest } from '../modules/construction/contracts.js';
import { __test as constructionTest } from '../modules/construction/index.js';
import construction from '../modules/construction/index.js';

function response() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
    end(value = '') { this.body = String(value); },
  };
}

const pageRes = response();
await handleContractsRequest(
  { method: 'GET' },
  pageRes,
  '/contracts',
  new URL('https://example.test/contracts?contract=1&contractManage=1'),
  { tenantKey: 'engineering' },
);
assert.equal(pageRes.status, 200);
assert.match(pageRes.body, /工程合約管理/);
assert.match(pageRes.body, /待我方確認/);
assert.match(pageRes.body, /付款管理/);
assert.match(pageRes.body, /驗收管理/);
assert.match(pageRes.body, /合約範本版本庫/);
assert.match(pageRes.body, /showVersionLibrary/);
assert.match(pageRes.body, /新增合約範本 V1/);
assert.match(pageRes.body, /templates\/versions/);
assert.match(pageRes.body, /templateVersionId/);
assert.doesNotMatch(pageRes.body, /新增合約並建立 V1/);
assert.doesNotMatch(pageRes.body, /startContractVersionFromLibrary/);
assert.match(pageRes.body, /openWorkflow\(created\.id,true\)/);
assert.match(pageRes.body, /＋ 新增 V/);
assert.match(pageRes.body, /startNewVersion/);
assert.match(pageRes.body, /從 V1 起累積保留所有歷史附件/);
assert.match(pageRes.body, /每個附件右側都會直接顯示紅色 ×/);
assert.match(pageRes.body, /pkg\.constructionDrawings=\[\.\.\.\(pkg\.constructionDrawings\|\|\[\]\),WORKFLOW\.files\.construction_drawing\]/);
assert.match(pageRes.body, /attachment-remove/);
assert.match(pageRes.body, /\.attachment-remove\{[^}]*opacity:1/);
assert.match(pageRes.body, /removeAttachmentInNextVersion/);
assert.match(pageRes.body, /attachmentExclusions:\[fileId\]/);
assert.match(pageRes.body, /舊版本與 Drive 原始檔仍會保留/);
assert.match(pageRes.body, /JSON\.parse\(JSON\.stringify\(previous\)\)/);
assert.match(pageRes.body, /舊版不會被覆寫/);
assert.match(pageRes.body, /完整審閱意見/);
assert.match(pageRes.body, /依此意見建立下一版本/);
assert.match(pageRes.body, /startRevisionFromReview/);
assert.match(pageRes.body, /revisionSource/);
assert.match(pageRes.body, /草約審閱意見仍完整保留/);
assert.match(pageRes.body, /退回草稿/);
assert.match(pageRes.body, /workflowReturnToDraft/);
assert.match(pageRes.body, /return-draft/);
assert.match(pageRes.body, /已送交內部審查/);
assert.match(pageRes.body, /草約未送出/);
assert.match(pageRes.body, /內部審查文件（唯讀）/);
assert.match(pageRes.body, /開啟完整合併合約 PDF/);
assert.match(pageRes.body, /internal-preview/);
assert.match(pageRes.body, /internal-attachments/);
assert.match(pageRes.body, /不會送出 LINE/);
assert.match(pageRes.body, /LINE 對話封存/);
assert.match(pageRes.body, /立即補封存先前/);
assert.match(pageRes.body, /功能上線前送出的草約不會自動補建/);
assert.match(pageRes.body, /esc\(String\(draftArchiveCount\)\)/);
assert.match(pageRes.body, /workflowBackfillLineArchives/);
assert.match(pageRes.body, /line-archives/);
assert.match(pageRes.body, /補充早期 LINE 對話證據/);
assert.match(pageRes.body, /line-archive-supplements/);
assert.match(pageRes.body, /r\.workflowState \|\| r\.signingStatus/);
assert.doesNotMatch(pageRes.body, /請先上傳三份必要附件/);
assert.match(pageRes.body, /const CAN_MANAGE = true/);
assert.doesNotMatch(pageRes.body, /localStorage/);
const inlineScripts = [...pageRes.body.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
assert.ok(inlineScripts.length > 0, 'contract workspace must include its browser script');
for (const source of inlineScripts) new Function(source);

const tenant = { key: 'engineering' };
const access = {
  allowed: true,
  isPlatformOwner: false,
  user: {
    role: 'member',
    allowedFeatures: ['am-engineering-contract-view', 'am-engineering-contract-issue'],
  },
};
const portal = {
  resolveAccess: async () => access,
  tenantScope: () => 'ZS',
  featureGranted: (user, _tenant, feature) => user.allowedFeatures.includes(`am-engineering-${feature}`),
};
const auth = await constructionTest.resolveAuth(portal, tenant, {}, access);
assert.equal(auth.canContract, true);
assert.equal(auth.canContractManage, false);
assert.equal(auth.canContractIssue, true);
assert.equal(auth.canContractConfirm, false);
assert.equal(auth.scope, 'ZS');
const publicSigningRoute = construction.routes.find((route) => route.prefix === '/contract-sign');
assert.equal(publicSigningRoute?.access?.kind, 'public');

console.log('Engineering contract workspace dry-run passed: graphical workspace and split permissions verified.');
