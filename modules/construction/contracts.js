// 合約發包管理(/contracts)——抽自 BuildAM src/contracts.js,改為多租戶。
// 授權/scope 由 index.js 的 webRoute(走 core.portal)注入 URL(不信任前端原始參數);權限鍵 per-tenant:am-<tenant>-contract。
// 合約簽約/金額異動會自動回寫該租戶「預算控制」的已發包金額/對象/日期/狀態。

import crypto from 'node:crypto';
import { plain, sameId, textFrag, queryAll, readJsonBody, sendJson, parseScope, assertProjectInScope } from './common.js';
import { createContractWorkflowApiHandler } from './contract-workflow-api.js';
import { contractFileUploadMetadata, readContractFileBody, uploadContractSourceFile } from './contract-files.js';
import { contractSigningRuntimeReadiness } from './contract-runtime.js';

const STATUSES = ['洽談中', '報價中', '已簽約', '施工中', '已完工', '結案', '作廢'];
// 這些狀態的合約金額計入「已發包」
const COMMITTED_STATUSES = new Set(['已簽約', '施工中', '已完工', '結案']);

function requiredTemplateText(value, label, max) {
  const text = String(value || '').trim();
  if (!text) throw Object.assign(new Error(`請填寫${label}`), { statusCode: 400 });
  if (text.length > max) throw Object.assign(new Error(`${label}內容過長`), { statusCode: 400 });
  return text;
}

async function verifyTemplateFile(deps, file) {
  if (!file || typeof file !== 'object' || Array.isArray(file)) throw Object.assign(new Error('請先上傳合約範本檔案'), { statusCode: 400 });
  const fileId = requiredTemplateText(file.fileId, '範本檔案', 200);
  const name = requiredTemplateText(file.name, '檔案名稱', 300);
  const claimedHash = String(file.sha256 || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(claimedHash)) throw Object.assign(new Error('範本檔案雜湊不正確'), { statusCode: 400 });
  const privacy = await deps.auditDrivePrivate?.(fileId);
  if (privacy?.private !== true) throw Object.assign(new Error('合約範本檔案不可公開分享'), { statusCode: 503 });
  const downloaded = await deps.downloadFromDrive?.(fileId, 25 * 1024 * 1024);
  if (!downloaded?.buffer) throw Object.assign(new Error('無法重新讀取合約範本檔案'), { statusCode: 503 });
  const actualHash = crypto.createHash('sha256').update(downloaded.buffer).digest('hex');
  if (actualHash !== claimedHash) throw Object.assign(new Error('合約範本檔案驗證失敗'), { statusCode: 409 });
  return {
    category: 'contract_body', fileId, name, sha256: actualHash,
    mimeType: String(file.mimeType || downloaded.contentType || 'application/octet-stream'),
    sizeBytes: downloaded.buffer.length, required: true,
  };
}

async function assertContractPage(deps, pageId) {
  const page = await deps.notionRequest(`/v1/pages/${encodeURIComponent(pageId)}`, { method: 'GET' });
  if (!sameId(page.parent?.data_source_id, deps.dataSources.contracts)) {
    throw new Error('不是發包合約的資料列');
  }
  return page;
}

function contractProjectId(page) {
  return page?.properties?.['專案']?.relation?.[0]?.id || '';
}

async function assertContractInScope(deps, scope, pageId) {
  const page = await assertContractPage(deps, pageId);
  const projectId = contractProjectId(page);
  if (!projectId) throw new Error('合約未綁定工程專案，禁止修改');
  try {
    await assertProjectInScope(deps, scope, projectId);
  } catch (error) {
    error.statusCode = 403;
    throw error;
  }
  return { page, projectId };
}

async function assertRelationBelongsToProject(deps, pageId, dataSourceId, projectId, label) {
  if (!pageId) return;
  const page = await deps.notionRequest(`/v1/pages/${encodeURIComponent(pageId)}`, { method: 'GET' });
  if (!sameId(page.parent?.data_source_id, dataSourceId)) throw new Error(`${label}資料來源不正確`);
  const relatedProjects = page.properties?.['專案']?.relation || [];
  if (!relatedProjects.some((item) => sameId(item.id, projectId))) throw new Error(`${label}不屬於這個工程專案`);
}

async function assertContractRelations(deps, fields, projectId) {
  if (fields.budgetItem) {
    if (!deps.dataSources.budgets) throw new Error('預算資料庫尚未設定');
    await assertRelationBelongsToProject(deps, fields.budgetItem, deps.dataSources.budgets, projectId, '預算項目');
  }
  if (fields.group) {
    if (!deps.dataSources.groupBindings) throw new Error('群組綁定資料庫尚未設定');
    await assertRelationBelongsToProject(deps, fields.group, deps.dataSources.groupBindings, projectId, '負責群組');
  }
}

async function appendLog(deps, pageId, action, operator, detail) {
  const stamp = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
  await deps.notionRequest(`/v1/blocks/${encodeURIComponent(pageId)}/children`, {
    method: 'PATCH',
    body: { children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: textFrag(`[${action}] ${stamp} ${operator || '合約頁'}:${detail}`) } }] },
  }).catch(() => {});
}

// 沿用 BuildAM 原簽名 handler(req,res,pathname,url,deps);authed/key/contract/scope 由 index.webRoute 注入 URL。
// 授權已在 webRoute(core.portal)完成;此處只讀 webRoute 重算後的 budget/contract/scope,不再自檢 key。
export async function handleContractsRequest(req, res, pathname, url, deps) {
  const key = url.searchParams.get('key') || '';
  const canContract = url.searchParams.get('contract') === '1';
  const canManage = url.searchParams.get('contractManage') === '1';
  const canIssue = url.searchParams.get('contractIssue') === '1';
  const canConfirm = url.searchParams.get('contractConfirm') === '1';
  const canAdmin = url.searchParams.get('contractAdmin') === '1';
  const canBudget = url.searchParams.get('budget') === '1';
  const scope = parseScope(url);
  try {
    if (req.method === 'GET' && pathname === '/contracts') {
      res.writeHead(canContract ? 200 : 403, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(canContract ? renderContractsPage(deps.tenantKey, key, canBudget, canManage, canIssue, canConfirm) : renderDeniedPage());
    }
    if (req.method === 'POST' && pathname === '/contracts/api/v2/files') {
      if (!canManage) return sendJson(res, 403, { error: '只有合約管理者可以上傳合約附件' });
      const projectId = String(url.searchParams.get('projectId') || '').trim();
      if (!projectId) return sendJson(res, 400, { error: '缺少工程專案' });
      await assertProjectInScope(deps, scope, projectId);
      const metadata = contractFileUploadMetadata(req);
      const buffer = await readContractFileBody(req);
      const file = await uploadContractSourceFile(deps, {
        ...metadata, buffer, projectId, projectLabel: projectId, actor: deps.actor,
      });
      return sendJson(res, 200, { ok: true, data: file });
    }
    if (req.method === 'POST' && pathname === '/contracts/api/v2/template-files') {
      if (!canManage) return sendJson(res, 403, { error: '只有合約管理者可以上傳合約範本' });
      const metadata = contractFileUploadMetadata(req);
      if (metadata.kind !== 'contract_body') return sendJson(res, 400, { error: '範本版本只能上傳合約本文' });
      const buffer = await readContractFileBody(req);
      const file = await uploadContractSourceFile(deps, {
        ...metadata, buffer, projectId: 'template-library', projectLabel: '合約範本庫', actor: deps.actor,
      });
      return sendJson(res, 200, { ok: true, data: file });
    }
    if (req.method === 'GET' && pathname === '/contracts/api/v2/templates') {
      if (!canContract) return sendJson(res, 403, { error: '無合約範本檢視權限' });
      const templates = await deps.contractStore.listContractTemplates(deps.tenant);
      return sendJson(res, 200, { ok: true, data: templates?.value || templates || [] });
    }
    if (req.method === 'POST' && pathname === '/contracts/api/v2/templates/versions') {
      if (!canManage) return sendJson(res, 403, { error: '只有合約管理者可以新增合約範本版本' });
      const body = await readJsonBody(req);
      const templateId = String(body.templateId || '').trim();
      const input = {
        templateId: templateId || null,
        templateName: templateId ? '' : requiredTemplateText(body.templateName, '範本名稱', 300),
        contractType: templateId ? '' : requiredTemplateText(body.contractType, '合約類型', 160),
        description: String(body.description || '').trim().slice(0, 2000),
        effectiveDate: /^\d{4}-\d{2}-\d{2}$/.test(String(body.effectiveDate || '')) ? body.effectiveDate : null,
        notes: String(body.notes || '').trim().slice(0, 4000),
        file: await verifyTemplateFile(deps, body.file),
        actor: deps.actor,
      };
      const created = await deps.contractStore.createContractTemplateVersion(deps.tenant, input);
      return sendJson(res, 200, { ok: true, data: created?.value || created });
    }
    const handled = await createContractWorkflowApiHandler(deps)(req, res, pathname, url, {
      scope,
      capabilities: { view: canContract, manage: canManage, issue: canIssue, confirm: canConfirm, admin: canAdmin },
    });
    if (handled) return handled;
    if (!canContract) return sendJson(res, 403, { error: '無合約發包檢視權限' });

    if (req.method === 'GET' && pathname === '/contracts/api/overview') {
      return sendJson(res, 200, await buildOverview(deps, scope));
    }
    if (!canManage) return sendJson(res, 403, { error: '只有合約管理者可以新增、編輯或封存' });
    if (req.method === 'POST' && pathname === '/contracts/api/create') {
      return sendJson(res, 200, await createContract(deps, await readJsonBody(req), scope));
    }
    if (req.method === 'POST' && pathname === '/contracts/api/edit') {
      return sendJson(res, 200, await editContract(deps, await readJsonBody(req), scope));
    }
    if (req.method === 'POST' && pathname === '/contracts/api/archive') {
      return sendJson(res, 200, await archiveContract(deps, await readJsonBody(req), scope));
    }
    return sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error('Contracts error:', error);
    return sendJson(res, Number(error.statusCode) || 500, { error: error.message });
  }
}

async function buildOverview(deps, scope) {
  if (!deps.dataSources.contracts) throw new Error('發包合約資料庫尚未設定(<PREFIX>_CONTRACTS_DATA_SOURCE_ID)');
  const projectPages = await queryAll(deps, deps.dataSources.projects);
  const projects = [];
  for (const page of projectPages) {
    const p = page.properties;
    const code = plain(p['館別代碼']?.rich_text);
    if (scope && !scope.has(code)) continue;
    projects.push({ id: page.id, name: plain(p['專案名稱']?.title), code, status: p['狀態']?.select?.name || '' });
  }
  for (const project of projects) {
    // 可掛的預算項目(工程預算列;小項與總預算不列)
    const budgetItems = [];
    if (deps.dataSources.budgets) {
      const budgetPages = await queryAll(deps, deps.dataSources.budgets, { property: '專案', relation: { contains: project.id } });
      for (const b of budgetPages) {
        const bp = b.properties;
        if ((bp['類別']?.select?.name || '') !== '工程預算') continue;
        budgetItems.push({ id: b.id, name: plain(bp['預算項目']?.title), budget: bp['預算金額']?.number || 0 });
      }
    }
    const budgetNameById = new Map(budgetItems.map((b) => [b.id.replace(/-/g, ''), b.name]));
    // 群組(發包對象所在的 LINE 群組,討論記錄都在該群組的訊息裡)
    const groups = [];
    if (deps.dataSources.groupBindings) {
      const groupPages = await queryAll(deps, deps.dataSources.groupBindings, { property: '專案', relation: { contains: project.id } });
      for (const g of groupPages) {
        let members = {};
        try { members = JSON.parse(plain(g.properties['成員對照']?.rich_text)) || {}; } catch { members = {}; }
        groups.push({
          id: g.id,
          name: plain(g.properties['群組名稱']?.title),
          lineGroupId: plain(g.properties['LINE 群組 ID']?.rich_text),
          status: g.properties['狀態']?.select?.name || '',
          members: Object.entries(members).map(([name, userId]) => ({ name, userId })),
        });
      }
    }
    const groupNameById = new Map(groups.map((g) => [g.id.replace(/-/g, ''), g.name]));

    const contractPages = await queryAll(deps, deps.dataSources.contracts, { property: '專案', relation: { contains: project.id } });
    const rows = [];
    for (const page of contractPages) {
      const p = page.properties;
      const budgetItemId = p['預算項目']?.relation?.[0]?.id || '';
      const groupId = p['負責群組']?.relation?.[0]?.id || '';
      rows.push({
        id: page.id,
        number: plain(p['編號']?.title),
        name: plain(p['合約名稱']?.rich_text),
        vendor: plain(p['承攬對象']?.rich_text),
        amount: p['合約金額']?.number || 0,
        status: p['狀態']?.select?.name || '洽談中',
        signDate: (p['簽約日期']?.date?.start || '').slice(0, 10),
        budgetItemId,
        budgetItemName: budgetItemId ? (budgetNameById.get(budgetItemId.replace(/-/g, '')) || '(已封存的預算項)') : '',
        groupId,
        groupName: groupId ? (groupNameById.get(groupId.replace(/-/g, '')) || '') : '',
        links: plain(p['資料連結']?.rich_text),
        note: plain(p['備註']?.rich_text),
        notionUrl: page.url,
      });
    }
    rows.sort((a, b) => (b.number || '').localeCompare(a.number || ''));
    project.rows = rows;
    project.budgetItems = budgetItems;
    project.groups = groups;
    project.committed = rows.filter((r) => COMMITTED_STATUSES.has(r.status)).reduce((sum, r) => sum + r.amount, 0);
    project.pending = rows.filter((r) => !COMMITTED_STATUSES.has(r.status) && r.status !== '作廢').length;
  }
  const evidenceStore = deps.contractStore
    ? await deps.contractStore.status(deps.tenant).catch(() => ({ configured: true, schemaReady: false, error: 'unavailable' }))
    : { configured: false, schemaReady: false };
  if (evidenceStore.schemaReady) {
    try {
      const workflowRows = await deps.contractStore.listContracts(deps.tenant, projects.map((project) => project.id));
      const byNotionPage = new Map((workflowRows || []).map((item) => [String(item.notion_contract_page_id || ''), item]));
      for (const project of projects) {
        for (const row of project.rows) {
          const workflow = byNotionPage.get(String(row.id));
          row.workflowContractId = workflow?.id || '';
          row.workflowState = workflow?.workflow_state || '';
          row.signingStatus = workflow?.signing_status || '';
          row.signingSessionId = workflow?.signing_external_session_id || '';
          row.latestVersion = Number(workflow?.latest_version || 0);
        }
      }
    } catch {
      // Keep the Notion projection usable while the evidence store is temporarily unavailable.
    }
  }
  const runtimeSecurity = contractSigningRuntimeReadiness(deps);
  return {
    projects,
    statuses: STATUSES,
    electronicSigning: {
      evidenceStoreConfigured: Boolean(evidenceStore.configured),
      evidenceSchemaReady: Boolean(evidenceStore.schemaReady),
      signingEnabled: deps.tenant?.config?.contracts?.signingEnabled === true,
      liffConfigured: Boolean(deps.tenant?.config?.contracts?.liffId),
      liffEndpointConfigured: runtimeSecurity.checks.liffEndpoint,
      publicBaseUrlConfigured: runtimeSecurity.checks.publicBaseUrl,
      trustedProxyConfigured: runtimeSecurity.checks.trustedProxy,
      dedicatedDatabaseConfigured: runtimeSecurity.checks.dedicatedDatabase,
      databaseTlsConfigured: runtimeSecurity.checks.databaseTls,
      tokenPepperConfigured: Buffer.byteLength(String(deps.tenant?.config?.contracts?.tokenPepper || ''), 'utf8') >= 32,
      pdfRendererConfigured: /^https:\/\//i.test(String(deps.tenant?.config?.contracts?.pdfRenderUrl || ''))
        && Buffer.byteLength(String(deps.tenant?.config?.contracts?.pdfRenderToken || ''), 'utf8') >= 32,
      driveConfigured: Boolean(deps.driveConfigured),
      ready: Boolean(runtimeSecurity.ready
        && evidenceStore.schemaReady && deps.tenant?.config?.contracts?.liffId
        && Buffer.byteLength(String(deps.tenant?.config?.contracts?.tokenPepper || ''), 'utf8') >= 32
        && /^https:\/\//i.test(String(deps.tenant?.config?.contracts?.pdfRenderUrl || ''))
        && Buffer.byteLength(String(deps.tenant?.config?.contracts?.pdfRenderToken || ''), 'utf8') >= 32
        && deps.driveConfigured),
    },
  };
}

// 編號自動:<館別代碼>-CT-001(各租戶專案的館別代碼各自序號,不撞號)
async function nextNumber(deps, projectId) {
  const projectPage = await deps.notionRequest(`/v1/pages/${encodeURIComponent(projectId)}`, { method: 'GET' });
  const code = plain(projectPage.properties['館別代碼']?.rich_text) || 'XX';
  const existing = await queryAll(deps, deps.dataSources.contracts, { property: '專案', relation: { contains: projectId } });
  let max = 0;
  for (const page of existing) {
    const m = plain(page.properties['編號']?.title).match(/-CT-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${code}-CT-${String(max + 1).padStart(3, '0')}`;
}

function contractProperties(fields) {
  const props = {};
  if (fields.name !== undefined) props['合約名稱'] = { rich_text: textFrag(fields.name) };
  if (fields.vendor !== undefined) props['承攬對象'] = { rich_text: textFrag(fields.vendor) };
  if (fields.amount !== undefined) props['合約金額'] = { number: fields.amount === '' || fields.amount == null ? null : Number(fields.amount) };
  if (fields.status !== undefined) props['狀態'] = { select: fields.status ? { name: fields.status } : null };
  if (fields.signDate !== undefined) props['簽約日期'] = { date: fields.signDate ? { start: fields.signDate } : null };
  if (fields.budgetItem !== undefined) props['預算項目'] = { relation: fields.budgetItem ? [{ id: fields.budgetItem }] : [] };
  if (fields.group !== undefined) props['負責群組'] = { relation: fields.group ? [{ id: fields.group }] : [] };
  if (fields.links !== undefined) props['資料連結'] = { rich_text: textFrag(fields.links) };
  if (fields.note !== undefined) props['備註'] = { rich_text: textFrag(fields.note) };
  return props;
}

async function createContract(deps, { project, operator: _ignoredOperator, ...fields }, scope) {
  if (!project) throw new Error('project required');
  await assertProjectInScope(deps, scope, project);
  await assertContractRelations(deps, fields, project);
  if (fields.status && !STATUSES.includes(fields.status)) throw new Error('狀態不合法');
  const number = await nextNumber(deps, project);
  const props = contractProperties(fields);
  props['編號'] = { title: textFrag(number) };
  props['專案'] = { relation: [{ id: project }] };
  const created = await deps.notionRequest('/v1/pages', {
    method: 'POST',
    body: { parent: { type: 'data_source_id', data_source_id: deps.dataSources.contracts }, properties: props },
  });
  await appendLog(deps, created.id, '開立', deps.actor, `${fields.name || number} 對象=${fields.vendor || '-'} 金額=${fields.amount || 0} 狀態=${fields.status || '洽談中'}`);
  if (fields.budgetItem) await syncBudgetItem(deps, fields.budgetItem, deps.actor);
  return { ok: true, id: created.id, number };
}

async function editContract(deps, { page, operator: _ignoredOperator, ...fields }, scope) {
  if (!page) throw new Error('page required');
  const { page: before, projectId } = await assertContractInScope(deps, scope, page);
  await assertContractRelations(deps, fields, projectId);
  const oldBudgetItem = before.properties['預算項目']?.relation?.[0]?.id || '';
  if (fields.status && !STATUSES.includes(fields.status)) throw new Error('狀態不合法');
  await deps.notionRequest(`/v1/pages/${encodeURIComponent(page)}`, {
    method: 'PATCH',
    body: { properties: contractProperties(fields) },
  });
  const detail = Object.entries(fields).map(([k, v]) => `${k}=${v === '' ? '(清空)' : v}`).join(' ');
  await appendLog(deps, page, '編輯', deps.actor, detail);
  // 新舊掛的預算項目都要回寫(可能換掛)
  const touched = new Set([oldBudgetItem, fields.budgetItem !== undefined ? fields.budgetItem : oldBudgetItem].filter(Boolean));
  for (const id of touched) await syncBudgetItem(deps, id, deps.actor);
  return { ok: true };
}

async function archiveContract(deps, { page }, scope) {
  if (!page) throw new Error('page required');
  const { page: target } = await assertContractInScope(deps, scope, page);
  const budgetItem = target.properties['預算項目']?.relation?.[0]?.id || '';
  const number = plain(target.properties['編號']?.title);
  await deps.notionRequest(`/v1/pages/${encodeURIComponent(page)}`, { method: 'PATCH', body: { archived: true } });
  console.log(`Contract archived by ${deps.actor || 'unknown actor'}: ${number} (${page})`);
  if (budgetItem) await syncBudgetItem(deps, budgetItem, deps.actor);
  return { ok: true };
}

// 自動回寫預算控制:已發包金額=有效合約金額合計、發包對象=各合約對象、
// 發包日期=最早簽約日、狀態=未發包/部分發包/已發包
async function syncBudgetItem(deps, budgetItemId, operator) {
  if (!deps.dataSources.budgets) return;
  let budgetPage;
  try {
    budgetPage = await deps.notionRequest(`/v1/pages/${encodeURIComponent(budgetItemId)}`, { method: 'GET' });
  } catch { return; }
  if (!sameId(budgetPage.parent?.data_source_id, deps.dataSources.budgets)) return;

  const contracts = await queryAll(deps, deps.dataSources.contracts, { property: '預算項目', relation: { contains: budgetItemId } });
  // 依編號排序,讓發包對象的串接順序穩定
  contracts.sort((a, b) => plain(a.properties['編號']?.title).localeCompare(plain(b.properties['編號']?.title)));
  let committed = 0;
  const vendors = [];
  let earliest = '';
  for (const page of contracts) {
    const p = page.properties;
    if (!COMMITTED_STATUSES.has(p['狀態']?.select?.name || '')) continue;
    committed += p['合約金額']?.number || 0;
    const vendor = plain(p['承攬對象']?.rich_text);
    if (vendor && !vendors.includes(vendor)) vendors.push(vendor);
    const d = (p['簽約日期']?.date?.start || '').slice(0, 10);
    if (d && (!earliest || d < earliest)) earliest = d;
  }
  const budget = budgetPage.properties['預算金額']?.number || 0;
  const status = committed <= 0 ? '未發包' : (budget && committed >= budget ? '已發包' : '部分發包');
  await deps.notionRequest(`/v1/pages/${encodeURIComponent(budgetItemId)}`, {
    method: 'PATCH',
    body: { properties: {
      '已發包金額': { number: committed },
      '發包對象': { rich_text: textFrag(vendors.join('、')) },
      '發包日期': { date: earliest ? { start: earliest } : null },
      '狀態': { select: { name: status } },
    } },
  });
  await appendLog(deps, budgetItemId, '同步', operator, `依發包合約回寫:已發包=${committed} 對象=${vendors.join('、') || '-'} 狀態=${status}`);
}

function renderDeniedPage() {
  return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>工程合約管理</title>
<style>body{font-family:system-ui,'Noto Sans TC',sans-serif;background:#f5f7f6;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#22302a}
div{background:#fff;border:1px solid #e0e6e3;border-radius:16px;padding:28px;text-align:center;max-width:320px}
h1{font-size:17px;color:#2e7d52;margin:0 0 10px}p{font-size:13px;color:#6b7a72;line-height:1.7;margin:0}a{color:#2e7d52}</style></head>
<body><div><h1>📑 工程合約管理</h1><p>這個頁面的權限與專案檢視分開，需要另外授權。<br>請洽管理者開啟「合約管理」權限。<br><br><a href="/dashboard">← 回儀表板</a></p></div></body></html>`;
}

function renderContractsPage(tenantKey, key, canBudget, canManage, canIssue, canConfirm) {
  const qs = (extra) => `?tenant=${encodeURIComponent(tenantKey)}&key=${encodeURIComponent(key)}${extra || ''}`;
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>工程合約管理</title>
<style>
  :root { --green:#2e7d52; --bg:#f5f7f6; --card:#fff; --line:#e0e6e3; --dim:#6b7a72; --red:#a03e33; --amber:#8a6d1a; --blue:#3a5db0; }
  * { box-sizing:border-box; margin:0; }
  body { font-family:system-ui,-apple-system,'Noto Sans TC',sans-serif; background:var(--bg); color:#22302a; padding-bottom:60px; }
  header { background:var(--green); color:#fff; padding:12px 16px; display:flex; align-items:center; gap:14px; position:sticky; top:0; z-index:5; }
  header h1 { font-size:17px; }
  header a { margin-left:auto; color:#dff0e7; font-size:13px; text-decoration:none; }
  .tabs { display:flex; flex-wrap:wrap; gap:8px; padding:12px 12px 0; }
  .tab { background:var(--card); border:1px solid var(--line); border-radius:20px; padding:8px 16px; font-size:14px; cursor:pointer; }
  .tab.active { background:var(--green); color:#fff; border-color:var(--green); }
  .section { margin:12px; }
  .panel { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:14px; margin-bottom:12px; }
  .panel h3 { font-size:14px; color:var(--dim); margin-bottom:10px; }
  .stats { display:flex; gap:16px; flex-wrap:wrap; margin-bottom:6px; }
  .stat b { font-size:19px; display:block; font-variant-numeric:tabular-nums; }
  .stat span { font-size:11px; color:var(--dim); }
  .btn { background:var(--green); color:#fff; border:none; border-radius:8px; padding:7px 14px; font-size:13px; cursor:pointer; }
  .btn.ghost { background:#eef2f0; color:#22302a; }
  .twrap { overflow-x:auto; border:1px solid var(--line); border-radius:10px; }
  table { border-collapse:collapse; background:var(--card); font-size:13px; width:100%; min-width:900px; }
  th,td { border-bottom:1px solid var(--line); padding:8px 10px; text-align:left; white-space:nowrap; vertical-align:top; }
  th { background:#eef2f0; font-size:12px; }
  td.num,th.num { text-align:right; font-variant-numeric:tabular-nums; }
  .st-洽談中 { color:#98a5a0; }
  .st-報價中 { color:var(--blue); font-weight:600; }
  .st-已簽約 { color:var(--amber); font-weight:600; }
  .st-施工中 { color:var(--amber); font-weight:600; }
  .st-已完工 { color:#1d6b41; font-weight:600; }
  .st-結案 { color:#1d6b41; font-weight:600; }
  .st-作廢 { color:var(--red); text-decoration:line-through; }
  .rowbtn { border:none; background:#eef2f0; border-radius:6px; padding:4px 8px; font-size:12px; cursor:pointer; margin-left:4px; }
  input,select { border:1px solid var(--line); border-radius:6px; padding:6px 8px; font-size:13px; font-family:inherit; }
  input.money { width:130px; text-align:right; }
  .empty { color:var(--dim); padding:20px; text-align:center; font-size:13px; }
  .links a { display:block; font-size:12px; color:var(--green); max-width:180px; overflow:hidden; text-overflow:ellipsis; }
  .hint { font-size:11px; color:var(--dim); margin-top:8px; line-height:1.6; }
  .workspace-nav { display:flex; gap:8px; padding:12px 12px 0; overflow:auto; }
  .workspace-nav button { border:0; background:#e9f2ed; color:#245d42; border-radius:9px; padding:8px 12px; white-space:nowrap; font-size:12px; font-weight:650; cursor:pointer; }
  .workspace-nav button.active { background:var(--green); color:#fff; }
  .workspace-nav button:disabled { background:#eef0ef; color:#8a9690; cursor:not-allowed; }
  .page-message { margin:12px 12px 0; padding:10px 13px; border-radius:10px; background:#eaf6ef; border:1px solid #b9dfc8; color:#1f6542; font-size:12px; line-height:1.6; }
  .page-message.error { background:#fff0ee; border-color:#e6b8b1; color:#8d3027; }
  .version-list { margin-top:14px; }.version-list table{min-width:720px}.version-list .current{background:#f1f8f4}.version-missing{color:var(--red);font-size:11px;white-space:normal;max-width:280px}.review-note{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65;background:#fff;border:1px solid var(--line);border-radius:8px;padding:9px;margin-top:6px;min-width:260px}.revision-source{border-color:#e6b85c;background:#fffaf0}.revision-source .review-note{background:#fff}
  .readiness { margin:12px 12px 0; padding:11px 13px; border-radius:11px; background:#fff8df; border:1px solid #ead99a; font-size:12px; line-height:1.6; }
  .readiness.ready { background:#eaf6ef; border-color:#b9dfc8; color:#1f6542; }
  .modal { position:fixed; inset:0; z-index:20; background:rgba(22,34,27,.55); display:flex; align-items:flex-start; justify-content:center; padding:4vh 12px; overflow:auto; }
  .modal[hidden] { display:none; }
  .modal-card { width:min(860px,100%); background:#fff; border-radius:16px; border:1px solid var(--line); padding:18px; box-shadow:0 20px 60px rgba(0,0,0,.22); }
  .modal-head { display:flex; gap:12px; align-items:center; margin-bottom:12px; }.modal-head h2{font-size:18px}.modal-head button{margin-left:auto}
  .workflow-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px; }.workflow-box{border:1px solid var(--line);border-radius:10px;padding:12px}.workflow-box h4{font-size:13px;margin-bottom:8px}
  .workflow-box input,.workflow-box textarea{width:100%;margin-top:6px}.workflow-box textarea{min-height:90px;border:1px solid var(--line);border-radius:7px;padding:8px;font:inherit;font-size:13px}
  .workflow-actions { display:flex;flex-wrap:wrap;gap:8px;margin-top:14px }.workflow-state{padding:9px 11px;border-radius:9px;background:#eef6f1;font-size:13px;margin-bottom:12px}.file-state{font-size:11px;color:var(--dim);margin-top:5px;word-break:break-all}
</style>
</head>
<body>
<header><h1>📑 工程合約管理</h1>${canBudget ? `<a href="/budget${qs()}">→ 💰 預算控制</a>` : ''}<a href="/dashboard${qs()}" style="${canBudget ? 'margin-left:14px' : ''}">→ 儀表板</a></header>
<div class="workspace-nav"><button id="nav-overview" class="active" onclick="showOverview()">合約總覽</button><button id="nav-library" onclick="showVersionLibrary()">合約範本版本庫</button><button disabled>待簽署</button><button disabled>待我方確認</button><button disabled>付款管理</button><button disabled>驗收管理</button></div>
<div id="page-message" hidden></div>
<div id="readiness"></div>
<div class="tabs" id="tabs"></div>
<div class="section" id="main"><div class="empty">載入中…</div></div>
<div class="modal" id="workflow-modal" hidden><div class="modal-card"><div class="modal-head"><h2 id="workflow-title">合約工作區</h2><button class="rowbtn" onclick="closeWorkflow()">關閉</button></div><div id="workflow-body"></div></div></div>
<script>
const TENANT = ${JSON.stringify(tenantKey)};
const KEY = ${JSON.stringify(key)};
const CAN_MANAGE = ${JSON.stringify(Boolean(canManage))};
const CAN_ISSUE = ${JSON.stringify(Boolean(canIssue))};
const CAN_CONFIRM = ${JSON.stringify(Boolean(canConfirm))};
let DATA = null;
let CURRENT = null;
let WORKFLOW = { row:null, contract:null, detail:null, reviews:[], archives:[], files:{}, creatingVersion:false };
let TEMPLATES = [];
let TEMPLATE_UPLOAD = null;
let TEMPLATE_FORM_ID = null;
function esc(s) { return String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function money(n) { return '$' + Math.round(n || 0).toLocaleString('en-US'); }
function fmtNum(v) { const d = String(v ?? '').replace(/[^0-9]/g, ''); return d ? Number(d).toLocaleString('en-US') : ''; }
function unfmt(v) { return String(v || '').replace(/,/g, ''); }
const MONEY_ATTRS = 'type="text" inputmode="numeric" oninput="this.value=fmtNum(this.value)"';
async function api(path, body) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch('/contracts/api/' + path + sep + 'tenant=' + encodeURIComponent(TENANT) + '&key=' + encodeURIComponent(KEY),
    body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const j = await r.json();
  if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : (j.error?.message || r.status));
  return j;
}
async function apiV2(path, options={}) {
  const response=await fetch('/contracts/api/v2/'+path+'?tenant='+encodeURIComponent(TENANT)+'&key='+encodeURIComponent(KEY),{
    method:options.method||'GET',headers:options.body?{'content-type':'application/json'}:undefined,
    body:options.body?JSON.stringify(options.body):undefined
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error?.message||result.error||String(response.status));
  return result.data;
}
async function load(keepCurrent) {
  DATA = await api('overview');
  if (!keepCurrent || !DATA.projects.find(p => p.id === CURRENT)) {
    CURRENT = DATA.projects.length ? DATA.projects[0].id : null;
  }
  render();
}
function setWorkspaceNav(view) {
  document.getElementById('nav-overview').classList.toggle('active', view === 'overview');
  document.getElementById('nav-library').classList.toggle('active', view === 'library');
}
function showPageMessage(message, error=false) {
  const box=document.getElementById('page-message');
  box.hidden=!message; box.className='page-message'+(error?' error':''); box.textContent=message||'';
}
function showOverview() { setWorkspaceNav('overview'); render(); }
function render() {
  setWorkspaceNav('overview');
  const es = DATA.electronicSigning || {};
  const missing = [];
  if (!es.evidenceSchemaReady) missing.push('簽署證據資料庫');
  if (!es.signingEnabled) missing.push('電子簽署啟用開關');
  if (!es.liffConfigured) missing.push('LINE LIFF');
  if (!es.liffEndpointConfigured) missing.push('LIFF Endpoint URL');
  if (!es.publicBaseUrlConfigured) missing.push('正式 HTTPS 網址');
  if (!es.trustedProxyConfigured) missing.push('可信任 proxy/IP header');
  if (!es.dedicatedDatabaseConfigured) missing.push('工程專用資料庫聲明');
  if (!es.databaseTlsConfigured) missing.push('資料庫 verify-full，或 verify-pinned/CA/憑證指紋');
  if (!es.tokenPepperConfigured) missing.push('簽署權杖金鑰');
  if (!es.pdfRendererConfigured) missing.push('PDF 產製服務');
  if (!es.driveConfigured) missing.push('Drive 合約資料夾');
  document.getElementById('readiness').innerHTML = '<div class="readiness' + (es.ready ? ' ready' : '') + '">'
    + (es.ready ? '✓ 電子簽約底座已就緒，可進行文件凍結與 LINE 群組簽發。' : '電子簽約安全底座尚未啟用；目前先提供合約清冊。待設定：' + esc(missing.join('、') || '資料庫檢查'))
    + '</div>';
  document.getElementById('tabs').innerHTML = DATA.projects.map(p =>
    '<button class="tab' + (CURRENT === p.id ? ' active' : '') + '" onclick="pick(\\'' + p.id + '\\')">' + esc(p.name) + '(' + p.rows.length + ')</button>').join('');
  const main = document.getElementById('main');
  const p = DATA.projects.find(x => x.id === CURRENT);
  main.innerHTML = p ? renderProject(p) : '<div class="empty">沒有可看的專案</div>';
}
function pick(id) { CURRENT = id; render(); }
function linkify(s) {
  return String(s || '').split(/\\s+/).filter(Boolean).map(part =>
    /^https?:\\/\\//.test(part) ? '<a href="' + esc(part) + '" target="_blank">' + esc(part.replace(/^https?:\\/\\//, '').slice(0, 40)) + '…</a>' : esc(part)
  ).join(' ');
}
function renderProject(p) {
  const active = p.rows.filter(r => r.status !== '作廢');
  const stats = '<div class="stats">'
    + '<div class="stat"><b>' + active.length + '</b><span>合約數</span></div>'
    + '<div class="stat"><b>' + money(p.committed) + '</b><span>已發包金額(已簽約起算)</span></div>'
    + '<div class="stat"><b>' + p.pending + '</b><span>洽談/報價中</span></div>'
    + '</div>';
  const table = '<div class="twrap"><table>'
    + '<tr><th>編號</th><th>合約名稱</th><th>預算項目</th><th>承攬對象</th><th class="num">合約金額</th><th>狀態</th><th>電子簽署</th><th>簽約日期</th><th>群組</th><th>資料連結</th><th>備註</th><th></th></tr>'
    + '<tr id="new-row"><td colspan="12" style="text-align:center">' + (CAN_MANAGE ? '<button class="btn ghost" onclick="showNewForm()">＋ 新增工程合約</button>' : '<span class="hint">目前為唯讀權限</span>') + '</td></tr>'
    + p.rows.map(r => rowHtml(r)).join('')
    + '</table></div>'
    + (p.rows.length ? '' : '<div class="empty">尚無合約' + (CAN_MANAGE ? '，可從上方新增工程合約' : '') + '</div>');
  return '<div class="panel"><h3>' + esc(p.name) + ':發包合約</h3>' + stats + table
    + '<div class="hint">・狀態進入「已簽約」後,合約金額會自動回寫預算控制的「已發包金額/發包對象/發包日期/狀態」;改金額、換狀態、封存也會重算。<br>'
    + '・合約文件/圖面/簽約資料:貼網址到「資料連結」,或點「開Notion頁」把檔案直接拖進該合約頁面;每次操作都會留歷程。<br>'
    + '・群組欄位掛上該工班的 LINE 群組後,群組裡的討論(已全數落庫)就能對得上這份合約。</div></div>';
}
function rowHtml(r) {
  const workflowDisplayStatus = r.workflowState || r.signingStatus || (Number(r.latestVersion) > 0 ? 'draft' : '');
  return '<tr id="row-' + r.id + '">'
    + '<td><b>' + esc(r.number) + '</b></td><td style="white-space:normal;min-width:110px">' + esc(r.name) + '</td>'
    + '<td style="white-space:normal;min-width:100px">' + esc(r.budgetItemName) + '</td>'
    + '<td>' + esc(r.vendor) + '</td><td class="num">' + money(r.amount) + '</td>'
    + '<td class="st-' + esc(r.status) + '">' + esc(r.status) + '</td><td>' + esc(workflowStatusLabel(workflowDisplayStatus)||'—') + '</td><td>' + esc(r.signDate) + '</td>'
    + '<td style="white-space:normal;min-width:90px;font-size:12px">' + esc(r.groupName) + '</td>'
    + '<td class="links">' + linkify(r.links) + '</td>'
    + '<td style="white-space:normal;min-width:100px;font-size:12px">' + esc(r.note) + '</td>'
    + '<td><button class="rowbtn" onclick="openWorkflow(\\'' + r.id + '\\')">📑 合約工作區</button>' + (CAN_MANAGE ? '<button class="rowbtn" onclick="editForm(\\'' + r.id + '\\')">✏️ 編輯</button>' : '')
    + '<a class="rowbtn" style="text-decoration:none;display:inline-block" href="' + esc(r.notionUrl) + '" target="_blank">開Notion頁</a>'
    + (CAN_MANAGE ? '<button class="rowbtn" onclick="archiveRow(\\'' + r.id + '\\', \\'' + esc(r.number) + '\\')">🗄 封存</button>' : '') + '</td>'
    + '</tr>';
}
function selectHtml(id, options, value, blankLabel) {
  return '<select id="' + id + '">' + (blankLabel !== undefined ? '<option value="">' + esc(blankLabel) + '</option>' : '')
    + options.map(o => '<option value="' + esc(o.value ?? o) + '" ' + ((o.value ?? o) === value ? 'selected' : '') + '>' + esc(o.label ?? o) + '</option>').join('') + '</select>';
}
function formCells(r) {
  const p = DATA.projects.find(x => x.id === CURRENT);
  const budgetOpts = p.budgetItems.map(b => ({ value: b.id, label: b.name + '(' + money(b.budget) + ')' }));
  const groupOpts = p.groups.map(g => ({ value: g.id, label: g.name }));
  return '<td style="color:var(--dim)">' + (r.number ? esc(r.number) : '自動') + '</td>'
    + '<td><input id="f-name" value="' + esc(r.name || '') + '" style="width:130px" placeholder="例:鋁窗工程承攬"></td>'
    + '<td>' + selectHtml('f-budgetItem', budgetOpts, r.budgetItemId || '', '(不掛預算)') + '</td>'
    + '<td><input id="f-vendor" value="' + esc(r.vendor || '') + '" style="width:100px" placeholder="工班/廠商"></td>'
    + '<td class="num"><input id="f-amount" class="money" ' + MONEY_ATTRS + ' value="' + fmtNum(r.amount ?? '') + '"></td>'
    + '<td>' + selectHtml('f-status', DATA.statuses, r.status || '洽談中') + '</td><td>—</td>'
    + '<td><input id="f-signDate" type="date" value="' + esc(r.signDate || '') + '"></td>'
    + '<td>' + selectHtml('f-group', groupOpts, r.groupId || '', '(未掛群組)') + '</td>'
    + '<td><input id="f-links" value="' + esc(r.links || '') + '" style="width:150px" placeholder="合約/圖面網址,空格分隔"></td>'
    + '<td><input id="f-note" value="' + esc(r.note || '') + '" style="width:110px"></td>';
}
function readForm() {
  return {
    name: document.getElementById('f-name').value.trim(),
    budgetItem: document.getElementById('f-budgetItem').value,
    vendor: document.getElementById('f-vendor').value.trim(),
    amount: unfmt(document.getElementById('f-amount').value),
    status: document.getElementById('f-status').value,
    signDate: document.getElementById('f-signDate').value,
    group: document.getElementById('f-group').value,
    links: document.getElementById('f-links').value.trim(),
    note: document.getElementById('f-note').value.trim(),
  };
}
function showNewForm() {
  document.getElementById('new-row').innerHTML = formCells({})
    + '<td><button id="new-contract-save" class="rowbtn" style="background:var(--green);color:#fff" onclick="createContract()">建立合約</button><button class="rowbtn" onclick="render()">取消</button><div id="new-contract-error" class="version-missing"></div></td>';
  document.getElementById('f-name').focus();
}
function editForm(id) {
  const r = DATA.projects.find(p => p.id === CURRENT).rows.find(x => x.id === id);
  document.getElementById('row-' + id).innerHTML = formCells(r)
    + '<td><button class="rowbtn" style="background:var(--green);color:#fff" onclick="saveRow(\\'' + id + '\\')">存</button><button class="rowbtn" onclick="render()">取消</button></td>';
}
async function run(fn) { try { await fn(); await load(true); } catch (e) { showPageMessage(e.message,true); } }
async function createContract() {
  const f=readForm(); const errorBox=document.getElementById('new-contract-error'); const save=document.getElementById('new-contract-save');
  if(!f.name){errorBox.textContent='請先填寫合約名稱；工班、金額與附件都可稍後補。';document.getElementById('f-name').focus();return;}
  errorBox.textContent=''; save.disabled=true; save.textContent='建立中…';
  try{const created=await api('create',{project:CURRENT,...f});await load(true);showPageMessage('已建立 '+created.number+'；請接著上傳第一個合約版本 V1。');await openWorkflow(created.id,true);}
  catch(error){errorBox.textContent=error.message;save.disabled=false;save.textContent='建立合約';}
}
async function saveRow(id) { await run(() => api('edit', { page: id, ...readForm() })); }
async function archiveRow(id, number) {
  if (!confirm('確定封存合約「' + number + '」?已發包金額會同步重算(可在 Notion 垃圾桶找回)。')) return;
  await run(() => api('archive', { page: id }));
}
function closeWorkflow(){ document.getElementById('workflow-modal').hidden=true; WORKFLOW={row:null,contract:null,detail:null,reviews:[],archives:[],files:{},creatingVersion:false}; }
function workflowRow(id){ for(const p of DATA.projects){const row=p.rows.find(x=>x.id===id);if(row)return {row,project:p};}return null; }
async function openWorkflow(id,createNext=false){
  const found=workflowRow(id); if(!found)return;
  WORKFLOW={row:found.row,project:found.project,contract:null,detail:null,reviews:[],archives:[],files:{},creatingVersion:false,revisionReview:null};
  document.getElementById('workflow-title').textContent=(found.row.number||'')+' '+(found.row.name||'合約工作區');
  document.getElementById('workflow-modal').hidden=false;
  document.getElementById('workflow-body').innerHTML='<div class="empty">正在讀取合約版本…</div>';
  try{
    let contractId=found.row.workflowContractId;
    if(!contractId){
      if(!CAN_MANAGE)throw new Error('這份合約尚未建立工作區，請由合約管理者設定。');
      const synced=await apiV2('contracts/sync',{method:'POST',body:{
        projectId:found.project.id,projectCode:found.project.code,notionContractPageId:found.row.id,
        contractNumber:found.row.number,title:found.row.name||found.row.number,trade:'',
        counterpartyName:found.row.vendor,amount:found.row.amount,currency:'TWD',
        budgetItemId:found.row.budgetItemId,groupBindingId:found.row.groupId
      }});
      contractId=synced.contract.id; found.row.workflowContractId=contractId;
    }
    WORKFLOW.contract={id:contractId};
    WORKFLOW.detail=await apiV2('contracts/'+encodeURIComponent(contractId));
    try{WORKFLOW.reviews=await apiV2('contracts/'+encodeURIComponent(contractId)+'/draft-reviews');}catch{WORKFLOW.reviews=[];}
    try{const latest=WORKFLOW.detail.latestVersion;WORKFLOW.archives=latest?await apiV2('contracts/'+encodeURIComponent(contractId)+'/versions/'+encodeURIComponent(latest.id)+'/line-archives'):[];}catch{WORKFLOW.archives=[];}
    try{TEMPLATES=await apiV2('templates');}catch{TEMPLATES=[];}
    WORKFLOW.creatingVersion=Boolean(createNext&&WORKFLOW.detail.latestVersion);
    renderWorkflow();
  }catch(error){document.getElementById('workflow-body').innerHTML='<div class="readiness">'+esc(error.message)+'</div>';}
}
function workflowStatusLabel(status){return ({draft:'草稿',internal_review:'內部審查',approved:'已核准',frozen:'已凍結',issued:'已簽發',sent:'已發送',opened:'已收件／開啟',signed:'待我方確認',confirmed:'產製歸檔中',completed:'已完成',revoked:'已撤銷',expired:'已逾期',declined:'已拒絕'})[status]||status||'尚未建版';}
function draftReviewStatusLabel(status){return ({created:'準備發送',sent:'LINE 已接受發送',opened:'對方已開啟',no_changes:'暫無修改意見',changes_requested:'對方提出修改',expired:'已逾期',revoked:'已撤銷'})[status]||status||'—';}
function versionMissing(version){
  const pkg=version?.documentPackage||version?.snapshot?.documentPackage||{};const missing=[];
  if(!pkg.contractBody)missing.push('合約本文');if(!(pkg.constructionDrawings||[]).length)missing.push('施工圖');if(!pkg.quotation)missing.push('報價單');if(!(pkg.paymentMilestones||[]).length)missing.push('付款條件');if(!(pkg.acceptanceCriteria||pkg.acceptanceStandards||[]).length)missing.push('驗收標準');return missing;
}
function versionHistoryHtml(detail){
  const versions=detail?.versions||[];if(!versions.length)return '<div class="empty">尚未建立任何版本</div>';
  return '<div class="version-list"><h3>版本歷程（舊版不會被覆寫）</h3><div class="twrap"><table><tr><th>版本</th><th>狀態</th><th>建立時間</th><th>內容完整度</th><th>Bundle SHA-256</th></tr>'
    +versions.map((v,index)=>{const missing=versionMissing(v);return '<tr class="'+(index===0?'current':'')+'"><td><b>V'+v.versionNo+'</b>'+(index===0?'（目前）':'')+'</td><td>'+esc(workflowStatusLabel(v.status))+'</td><td>'+esc((v.createdAt||'').replace('T',' ').slice(0,16))+'</td><td>'+(missing.length?'<span class="version-missing">待補：'+esc(missing.join('、'))+'</span>':'✓ 五項完整')+'</td><td class="file-state">'+esc(v.attachmentManifestHash||'尚未產生')+'</td></tr>';}).join('')+'</table></div></div>';
}
function versionComposerHtml(nextVersion){
  const source=WORKFLOW.revisionReview;const sourceHtml=source?'<div class="workflow-box revision-source"><h4>V'+esc(source.versionNo)+' 草約的修訂依據</h4><div class="hint">回覆人：'+esc(source.reviewerName||'未提供')+' ／ 回覆時間：'+esc((source.respondedAt||'').replace('T',' ').slice(0,16)||'未記錄')+'</div><div class="review-note">'+esc(source.responseNotes||'未提供其他說明')+'</div></div>':'';
  return '<div class="workflow-state">建立 V'+nextVersion+'：新版本會先承接目前版本的全部內容，再用這次上傳或填寫的項目取代。每次儲存都會留下獨立版本，不會覆寫舊版；資料未完整時不得送審或簽發。</div>'+sourceHtml+'<div class="workflow-grid">'
    +templatePickerBox()+uploadBox('contract_body','合約本文（也可自行上傳）')+uploadBox('construction_drawing','施工圖（可稍後版本補齊）')+uploadBox('quotation','報價單（可稍後版本補齊）')
    +'<div class="workflow-box"><h4>付款條件（可選）</h4><input id="wf-pay-label" placeholder="例：完工驗收後七日內"><input id="wf-pay-trigger" placeholder="付款時間／里程碑條件"></div>'
    +'<div class="workflow-box"><h4>驗收標準（可選）</h4><textarea id="wf-acceptance" placeholder="每行一項可量測的驗收標準"></textarea></div></div>'
    +'<div class="workflow-actions"><button class="btn" onclick="createWorkflowDraft()">儲存 V'+nextVersion+'</button>'+(WORKFLOW.detail?.latestVersion?'<button class="btn ghost" onclick="cancelNewVersion()">取消新增版本</button>':'')+'</div>';
}
function draftReviewHistoryHtml(){const reviews=WORKFLOW.reviews||[];if(!reviews.length)return '';
  return '<div class="version-list"><h3>草約審閱紀錄（不屬於正式簽署）</h3><div class="twrap"><table><tr><th>版本</th><th>狀態</th><th>LINE 發送</th><th>開啟</th><th>回覆</th><th>完整審閱意見</th><th></th></tr>'
    +reviews.map(r=>'<tr><td>V'+esc(r.versionNo)+'</td><td>'+esc(draftReviewStatusLabel(r.status))+'</td><td>'+esc((r.sentAt||'—').replace('T',' ').slice(0,16))+'</td><td>'+esc((r.openedAt||'—').replace('T',' ').slice(0,16))+'</td><td>'+esc((r.respondedAt||'—').replace('T',' ').slice(0,16))+'</td><td><b>'+esc(r.reviewerName||'—')+'</b><div class="review-note">'+esc(r.responseNotes||(r.status==='no_changes'?'目前暫無修改意見':'尚未回覆'))+'</div></td><td>'+(CAN_MANAGE&&r.status==='changes_requested'?'<button class="rowbtn" onclick="startRevisionFromReview(\\\''+esc(r.id)+'\\\')">依此意見建立下一版本</button>':'')+'</td></tr>').join('')+'</table></div></div>';}
function internalVersionAttachments(version){const pkg=version?.documentPackage||version?.snapshot?.documentPackage||{};const items=[pkg.contractBody?{...pkg.contractBody,category:'contract_body'}:null,...(pkg.constructionDrawings||[]).map(x=>({...x,category:'construction_drawing'})),pkg.quotation?{...pkg.quotation,category:'quotation'}:null,...(pkg.attachments||[])].filter(Boolean);const seen=new Set();return items.flatMap(item=>{const fileId=String(item.fileId||item.file_id||'');if(!fileId||seen.has(fileId))return [];seen.add(fileId);return [{id:String(seen.size-1),name:item.name||item.fileName||('附件 '+seen.size),category:item.category||'other'}];});}
function internalDocumentHref(version,path){return '/contracts/api/v2/contracts/'+encodeURIComponent(WORKFLOW.contract.id)+'/versions/'+encodeURIComponent(version.id)+'/'+path+'?tenant='+encodeURIComponent(TENANT)+'&key='+encodeURIComponent(KEY);}
function internalPreviewHtml(version){const labels={contract_body:'合約本文',construction_drawing:'施工圖',quotation:'報價單',other:'附件'};const files=internalVersionAttachments(version);const archives=WORKFLOW.archives||[];const sentReviews=(WORKFLOW.reviews||[]).filter(r=>r.sentAt).length;return '<div class="workflow-box" style="margin-top:14px"><h4>內部審查文件（唯讀）</h4><div class="hint">只供內部檢視，不會送出 LINE、不會改變版本狀態，也不會產生簽署紀錄。</div><div class="workflow-actions"><a class="btn" target="_blank" rel="noopener" style="text-decoration:none" href="'+esc(internalDocumentHref(version,'internal-preview'))+'">開啟完整合併合約 PDF</a></div><div class="hint">原始附件可分別開啟核對：</div><div class="workflow-actions">'+files.map(file=>'<a class="rowbtn" target="_blank" rel="noopener" style="text-decoration:none;display:inline-block" href="'+esc(internalDocumentHref(version,'internal-attachments/'+encodeURIComponent(file.id)))+'">'+esc(labels[file.category]||labels.other)+'：'+esc(file.name)+'</a>').join('')+'</div><h4 style="margin-top:14px">LINE 對話封存</h4><div class="hint">每次送出版本前自動封存前一截止點之後的群組訊息；封存檔不可覆寫，並會合併到完整合約 PDF。</div><div class="workflow-actions">'+archives.map(a=>'<a class="rowbtn" target="_blank" rel="noopener" style="text-decoration:none;display:inline-block" href="'+esc(internalDocumentHref(version,'line-archives/'+encodeURIComponent(a.id)))+'">V'+esc(a.versionNo)+' '+esc(a.stageLabel)+'（'+esc(a.messageCount)+' 則）</a>').join('')+(CAN_MANAGE&&sentReviews>archives.filter(a=>a.stage==='draft_review').length?'<button class="rowbtn" onclick="workflowBackfillLineArchives()">補封存既有版本對話</button>':'')+'</div>'+(archives.length?'':'<div class="file-state">尚無 LINE 對話封存；第一次送出草約時會自動建立。</div>')+'</div>';}
function templatePickerBox(){const options=TEMPLATES.flatMap(t=>(t.versions||[]).slice(0,1).map(v=>'<option value="'+esc(v.id)+'">'+esc(t.contract_type)+'／'+esc(t.template_name)+' V'+v.versionNo+'</option>')).join('');return '<div class="workflow-box"><h4>套用公版合約範本（可選）</h4><select id="wf-template-version" style="width:100%"><option value="">不套用範本，直接上傳本文</option>'+options+'</select><div class="hint">範本只帶入合約本文；施工圖、報價、付款與驗收仍屬於這個工程合約。</div></div>';}
function renderWorkflow(){
  const latest=WORKFLOW.detail?.latestVersion; const status=latest?.status||'';
  const body=document.getElementById('workflow-body');
  let html='<div class="workflow-state">目前版本：'+(latest?'V'+latest.versionNo+' ／ '+workflowStatusLabel(status):'尚未建立')+'</div>';
  if((!latest||WORKFLOW.creatingVersion)&&CAN_MANAGE){
    html+=versionComposerHtml((latest?.versionNo||0)+1);
  } else if(latest){
    html+='<div class="workflow-grid"><div class="workflow-box"><h4>五項必要內容</h4><div class="hint">合約本文、施工圖、報價單、付款條件、驗收標準均封裝在此版本；凍結後不可修改。</div></div><div class="workflow-box"><h4>附件雜湊</h4><div class="file-state">'+esc(latest.attachmentManifestHash||latest.bundle_sha256||'尚未凍結')+'</div></div></div>'+internalPreviewHtml(latest)+'<div class="workflow-actions">';
    if(CAN_MANAGE)html+='<button class="btn ghost" onclick="startNewVersion()">＋ 建立 V'+(latest.versionNo+1)+'</button>';
    if(status==='draft'&&CAN_MANAGE){const hasBody=!versionMissing(latest).includes('合約本文');if(hasBody&&WORKFLOW.row.groupId)html+='<button class="btn" onclick="workflowDraftReview()">產生草約並送 LINE 群組確認</button>';else html+='<span class="version-missing">草約至少需要合約本文，且合約必須綁定工程 LINE 群組。</span>';}
    if(status==='draft'&&CAN_MANAGE&&!versionMissing(latest).length)html+='<button class="btn" onclick="workflowTransition(\\'submit-review\\')">送交內部審查</button>';
    if(status==='draft'&&versionMissing(latest).length)html+='<span class="version-missing">五項內容未完整，請建立下一版本補齊後再送審。</span>';
    if(status==='internal_review'&&CAN_MANAGE)html+='<button class="btn ghost" onclick="workflowReturnToDraft()">退回草稿</button>';
    if(status==='internal_review'&&CAN_ISSUE)html+='<button class="btn" onclick="workflowTransition(\\'approve\\')">核准版本</button>';
    if(status==='approved'&&CAN_ISSUE)html+='<button class="btn" onclick="workflowTransition(\\'freeze\\')">凍結版本</button>';
    if(status==='frozen'){html+='<button class="btn ghost" onclick="workflowReadiness()">檢查簽發條件</button>';if(CAN_ISSUE)html+=signerSelect()+'<button class="btn" onclick="workflowIssue(\\'issue\\')">產生 PDF 並送到 LINE 群組</button>';}
    if(status==='issued'){html+='<span class="hint">電子簽署：'+esc(workflowStatusLabel(WORKFLOW.row.signingStatus)||'尚未送簽')+'</span>';if(CAN_ISSUE&&['','revoked','expired','declined'].includes(WORKFLOW.row.signingStatus))html+=signerSelect()+'<button class="btn ghost" onclick="workflowIssue(\\'retry-signing\\')">以同一版本重新送簽</button>';if(CAN_CONFIRM&&['signed','confirmed'].includes(WORKFLOW.row.signingStatus)&&WORKFLOW.row.signingSessionId)html+='<button class="btn" onclick="workflowComplete()">確認簽署並產生最終歸檔</button>';}
    html+='</div><div id="workflow-result"></div>';
  }
  html+=draftReviewHistoryHtml();
  html+=versionHistoryHtml(WORKFLOW.detail);
  body.innerHTML=html;
}
function startNewVersion(){WORKFLOW.files={};WORKFLOW.revisionReview=null;WORKFLOW.creatingVersion=true;renderWorkflow();}
function startRevisionFromReview(reviewId){const review=(WORKFLOW.reviews||[]).find(item=>item.id===reviewId);if(!review)return alert('找不到這筆草約意見');WORKFLOW.files={};WORKFLOW.revisionReview=review;WORKFLOW.creatingVersion=true;renderWorkflow();document.getElementById('workflow-body')?.scrollTo({top:0,behavior:'smooth'});}
function cancelNewVersion(){WORKFLOW.files={};WORKFLOW.revisionReview=null;WORKFLOW.creatingVersion=false;renderWorkflow();}
function uploadBox(kind,label){return '<div class="workflow-box"><h4>'+label+'</h4><input type="file" id="wf-file-'+kind+'" onchange="uploadWorkflowFile(\\''+kind+'\\')"><div class="file-state" id="wf-state-'+kind+'">尚未上傳</div></div>';}
async function uploadWorkflowFile(kind){
  const input=document.getElementById('wf-file-'+kind);const file=input.files?.[0];if(!file)return;
  const state=document.getElementById('wf-state-'+kind);state.textContent='上傳中…';
  try{const response=await fetch('/contracts/api/v2/files?tenant='+encodeURIComponent(TENANT)+'&key='+encodeURIComponent(KEY)+'&projectId='+encodeURIComponent(WORKFLOW.project.id),{method:'POST',headers:{'content-type':file.type||'application/octet-stream','x-contract-file-name':encodeURIComponent(file.name),'x-contract-document-kind':kind},body:file});const result=await response.json();if(!response.ok)throw new Error(result.error||response.status);WORKFLOW.files[kind]=result.data;state.textContent='✓ '+result.data.name+' ／ '+result.data.sha256.slice(0,12)+'…';}catch(error){state.textContent='上傳失敗：'+error.message;}
}
async function createWorkflowDraft(){
  try{const label=document.getElementById('wf-pay-label').value.trim();const trigger=document.getElementById('wf-pay-trigger').value.trim();const criteria=document.getElementById('wf-acceptance').value.split(/\\n+/).map(x=>x.trim()).filter(Boolean);const templateVersionId=document.getElementById('wf-template-version')?.value||'';
    if((label&&!trigger)||(!label&&trigger))throw new Error('付款條件與付款時間／里程碑需要一起填寫');
    if(!templateVersionId&&!WORKFLOW.files.contract_body&&!WORKFLOW.files.construction_drawing&&!WORKFLOW.files.quotation&&!label&&!criteria.length)throw new Error('請選擇合約範本、上傳一份文件，或填寫付款條件／驗收標準');
    const previous=WORKFLOW.detail?.latestVersion?.documentPackage||WORKFLOW.detail?.latestVersion?.snapshot?.documentPackage||{};const pkg=JSON.parse(JSON.stringify(previous));if(WORKFLOW.files.contract_body)pkg.contractBody=WORKFLOW.files.contract_body;if(WORKFLOW.files.construction_drawing)pkg.constructionDrawings=[WORKFLOW.files.construction_drawing];if(WORKFLOW.files.quotation)pkg.quotation=WORKFLOW.files.quotation;if(label)pkg.paymentMilestones=[{label,amount:Number(WORKFLOW.row.amount)||undefined,trigger}];if(criteria.length)pkg.acceptanceCriteria=criteria.map(criterion=>({criterion}));
    const revision=WORKFLOW.revisionReview;const revisionSource=revision?{draftReviewId:revision.id,sourceVersionNo:revision.versionNo,reviewerName:revision.reviewerName||'',decision:revision.decision||revision.status,responseNotes:revision.responseNotes||'',respondedAt:revision.respondedAt||''}:null;
    await apiV2('contracts/'+encodeURIComponent(WORKFLOW.contract.id)+'/versions',{method:'POST',body:{documentPackage:pkg,...(revisionSource?{snapshot:{revisionSource}}:{}),...(templateVersionId?{templateVersionId}:{})}});WORKFLOW.detail=await apiV2('contracts/'+encodeURIComponent(WORKFLOW.contract.id));WORKFLOW.row.workflowState='draft';WORKFLOW.row.latestVersion=WORKFLOW.detail.latestVersion?.versionNo||WORKFLOW.row.latestVersion;WORKFLOW.files={};WORKFLOW.revisionReview=null;WORKFLOW.creatingVersion=false;renderWorkflow();showPageMessage('新合約版本已保存；舊版本與草約審閱意見仍完整保留。');
  }catch(error){alert(error.message);}
}
async function showVersionLibrary(){
  setWorkspaceNav('library');document.getElementById('tabs').innerHTML='';const main=document.getElementById('main');main.innerHTML='<div class="panel"><h3>合約範本版本庫</h3><div class="empty">正在讀取公版合約範本…</div></div>';
  try{TEMPLATES=await apiV2('templates');TEMPLATE_FORM_ID=null;renderTemplateLibrary();}catch(error){main.innerHTML='<div class="panel"><h3>合約範本版本庫</h3><div class="readiness">'+esc(error.message)+'</div></div>';}
}
function renderTemplateLibrary(){
  const main=document.getElementById('main');const form=TEMPLATE_FORM_ID===null?'':templateVersionFormHtml(TEMPLATE_FORM_ID);const rows=TEMPLATES.flatMap(t=>(t.versions||[]).map((v,index)=>'<tr class="'+(index===0?'current':'')+'"><td>'+esc(t.contract_type)+'</td><td><b>'+esc(t.template_name)+'</b><br><span class="hint">'+esc(t.description||'')+'</span></td><td><b>V'+v.versionNo+'</b>'+(index===0?'（目前）':'')+'</td><td>'+esc(v.effectiveDate||'—')+'</td><td>'+esc(v.fileName)+'<br><span class="file-state">SHA-256 '+esc(String(v.sha256||'').slice(0,16))+'…</span></td><td>'+esc(v.notes||'')+'</td><td>'+(index===0&&CAN_MANAGE?'<button class="rowbtn" onclick="showTemplateVersionForm(\\''+t.id+'\\')">＋ 新增 V'+(v.versionNo+1)+'</button>':'')+'<a class="rowbtn" target="_blank" style="text-decoration:none;display:inline-block" href="https://drive.google.com/open?id='+encodeURIComponent(v.fileId)+'">查看檔案</a></td></tr>')).join('');
  main.innerHTML='<div class="panel"><h3>合約範本版本庫</h3><div class="hint">這裡只保存泥作、拆除、水電、木工等公版合約本文，不綁定工程、工班或金額。實際簽約時，再從「合約總覽」建立工程合約並套用範本。</div>'+(CAN_MANAGE?'<div class="workflow-actions"><button class="btn" onclick="showTemplateVersionForm(\\'\\')">＋ 新增合約範本 V1</button></div>':'')+form+'<div class="twrap version-list"><table><tr><th>合約類型</th><th>範本名稱</th><th>版本</th><th>生效日期</th><th>合約本文</th><th>版本備註</th><th></th></tr>'+rows+'</table></div>'+(rows?'':'<div class="empty">尚無公版合約範本。請按「新增合約範本 V1」上傳第一份版本。</div>')+'</div>';
}
function templateVersionFormHtml(templateId){const template=TEMPLATES.find(t=>t.id===templateId);return '<div class="workflow-box" style="margin-top:14px"><h4>'+(template?'新增 '+esc(template.template_name)+' V'+((template.versions?.[0]?.versionNo||0)+1):'新增公版合約範本 V1')+'</h4><div class="workflow-grid">'+(template?'<div><b>合約類型</b><div>'+esc(template.contract_type)+'</div></div><div><b>範本名稱</b><div>'+esc(template.template_name)+'</div></div>':'<label>合約類型<input id="tpl-type" placeholder="例：泥作合約"></label><label>範本名稱<input id="tpl-name" placeholder="例：泥作工程標準承攬合約"></label>')+'<label>生效日期<input id="tpl-effective" type="date"></label><label>適用說明<input id="tpl-description" value="'+esc(template?.description||'')+'" placeholder="適用範圍或使用提醒"></label><label>版本備註<input id="tpl-notes" placeholder="本版本的修改重點"></label><label>合約本文<input id="tpl-file" type="file" accept=".pdf,.docx" onchange="uploadTemplateFile()"><div id="tpl-file-state" class="file-state">尚未上傳</div></label></div><div class="workflow-actions"><button id="tpl-save" class="btn" onclick="saveTemplateVersion(\\''+esc(templateId)+'\\')">儲存版本</button><button class="btn ghost" onclick="cancelTemplateVersionForm()">取消</button></div></div>';}
function showTemplateVersionForm(templateId=''){TEMPLATE_FORM_ID=templateId;TEMPLATE_UPLOAD=null;renderTemplateLibrary();document.getElementById(templateId?'tpl-file':'tpl-type')?.focus();}
function cancelTemplateVersionForm(){TEMPLATE_FORM_ID=null;TEMPLATE_UPLOAD=null;renderTemplateLibrary();}
async function uploadTemplateFile(){const input=document.getElementById('tpl-file');const file=input.files?.[0];if(!file)return;const state=document.getElementById('tpl-file-state');state.textContent='上傳與驗證中…';try{const response=await fetch('/contracts/api/v2/template-files?tenant='+encodeURIComponent(TENANT)+'&key='+encodeURIComponent(KEY),{method:'POST',headers:{'content-type':file.type||'application/octet-stream','x-contract-file-name':encodeURIComponent(file.name),'x-contract-document-kind':'contract_body'},body:file});const result=await response.json();if(!response.ok)throw new Error(result.error?.message||result.error||response.status);TEMPLATE_UPLOAD=result.data;state.textContent='✓ '+result.data.name+' ／ '+result.data.sha256.slice(0,16)+'…';}catch(error){TEMPLATE_UPLOAD=null;state.textContent='上傳失敗：'+error.message;}}
async function saveTemplateVersion(templateId){const save=document.getElementById('tpl-save');try{if(!TEMPLATE_UPLOAD)throw new Error('請先上傳這個版本的合約本文');const body={templateId:templateId||undefined,templateName:templateId?undefined:document.getElementById('tpl-name').value.trim(),contractType:templateId?undefined:document.getElementById('tpl-type').value.trim(),effectiveDate:document.getElementById('tpl-effective').value,description:document.getElementById('tpl-description').value.trim(),notes:document.getElementById('tpl-notes').value.trim(),file:TEMPLATE_UPLOAD};save.disabled=true;save.textContent='儲存中…';const created=await apiV2('templates/versions',{method:'POST',body});TEMPLATES=await apiV2('templates');TEMPLATE_FORM_ID=null;TEMPLATE_UPLOAD=null;renderTemplateLibrary();showPageMessage('已保存 '+created.template.template_name+' V'+created.version.version_no+'；這是公版範本，尚未建立任何工程合約。');}catch(error){showPageMessage(error.message,true);if(save){save.disabled=false;save.textContent='儲存版本';}}}
async function workflowTransition(action){try{const latest=WORKFLOW.detail.latestVersion;await apiV2('contracts/'+encodeURIComponent(WORKFLOW.contract.id)+'/versions/'+encodeURIComponent(latest.id)+'/'+action,{method:'POST',body:{}});WORKFLOW.detail=await apiV2('contracts/'+encodeURIComponent(WORKFLOW.contract.id));WORKFLOW.row.workflowState=WORKFLOW.detail.latestVersion?.status||WORKFLOW.row.workflowState;WORKFLOW.row.latestVersion=WORKFLOW.detail.latestVersion?.versionNo||WORKFLOW.row.latestVersion;renderWorkflow();const success=action==='submit-review'?'已送交內部審查。':action==='approve'?'版本已核准。':action==='freeze'?'版本已凍結。':'';if(success)alert(success);}catch(error){alert('操作未完成：'+error.message);}}
async function workflowReturnToDraft(){if(!confirm('確定將目前版本退回草稿？退回後可以修正內容，或重新產生草約送到 LINE 群組確認。'))return;try{const latest=WORKFLOW.detail.latestVersion;await apiV2('contracts/'+encodeURIComponent(WORKFLOW.contract.id)+'/versions/'+encodeURIComponent(latest.id)+'/return-draft',{method:'POST',body:{}});WORKFLOW.detail=await apiV2('contracts/'+encodeURIComponent(WORKFLOW.contract.id));WORKFLOW.row.workflowState='draft';WORKFLOW.row.latestVersion=WORKFLOW.detail.latestVersion?.versionNo||WORKFLOW.row.latestVersion;renderWorkflow();alert('已退回草稿；現在可以重新產生草約並送 LINE 群組確認。');}catch(error){alert('退回草稿失敗：'+error.message);}}
async function workflowDraftReview(){try{const latest=WORKFLOW.detail.latestVersion;if(!confirm('系統會先封存上一個截止點之後的 LINE 群組對話，再產生有「草約／不得簽署」標示的 PDF 並送到工程 LINE 群組。封存或送出任一步失敗都不會完成發送。確定送出？'))return;const result=await apiV2('contracts/'+encodeURIComponent(WORKFLOW.contract.id)+'/versions/'+encodeURIComponent(latest.id)+'/draft-review',{method:'POST',body:{}});WORKFLOW.reviews=await apiV2('contracts/'+encodeURIComponent(WORKFLOW.contract.id)+'/draft-reviews');WORKFLOW.archives=await apiV2('contracts/'+encodeURIComponent(WORKFLOW.contract.id)+'/versions/'+encodeURIComponent(latest.id)+'/line-archives');renderWorkflow();alert(result.sent?'LINE 對話已封存，草約也已送到工程 LINE 群組；系統會記錄開啟與意見回覆。':'草約已建立，但 LINE 尚未接受發送。');}catch(error){alert('草約未送出：'+error.message+'\\n\\n合約仍維持草稿，不會產生簽署效力。');}}
async function workflowBackfillLineArchives(){try{const latest=WORKFLOW.detail.latestVersion;if(!confirm('系統會依既有草約的 LINE 發送時間，回溯建立 V1、V2 等對話封存；不會重新發送訊息。確定執行？'))return;const result=await apiV2('contracts/'+encodeURIComponent(WORKFLOW.contract.id)+'/versions/'+encodeURIComponent(latest.id)+'/line-archives',{method:'POST',body:{}});WORKFLOW.archives=await apiV2('contracts/'+encodeURIComponent(WORKFLOW.contract.id)+'/versions/'+encodeURIComponent(latest.id)+'/line-archives');renderWorkflow();alert('已完成 '+result.createdOrExisting+' 個既有版本的 LINE 對話封存。');}catch(error){alert('LINE 對話回溯封存失敗：'+error.message);}}
async function workflowReadiness(){try{const latest=WORKFLOW.detail.latestVersion;const result=await apiV2('contracts/'+encodeURIComponent(WORKFLOW.contract.id)+'/versions/'+encodeURIComponent(latest.id)+'/readiness');document.getElementById('workflow-result').innerHTML='<div class="readiness '+(result.ready?'ready':'')+'">'+(result.ready?'✓ 文件、付款條件、驗收標準與凍結雜湊完整，可以進入 LINE 群組簽發。':result.blockers.map(x=>esc(x.message)).join('<br>'))+'</div>';}catch(error){alert(error.message);}}
function signerSelect(){const group=WORKFLOW.project.groups.find(g=>g.id.replace(/-/g,'')===String(WORKFLOW.row.groupId||'').replace(/-/g,''));const members=group?.members||[];return '<select id="wf-signer"><option value="">指定簽署人</option>'+members.map(m=>'<option value="'+esc(m.userId)+'">'+esc(m.name)+'</option>').join('')+'</select>';}
async function workflowIssue(action){try{const signer=document.getElementById('wf-signer')?.value;if(!signer)throw new Error('請指定目前仍在工程 LINE 群組內的簽署人');const latest=WORKFLOW.detail.latestVersion;const result=await apiV2('contracts/'+encodeURIComponent(WORKFLOW.contract.id)+'/versions/'+encodeURIComponent(latest.id)+'/'+action,{method:'POST',body:{signerLineUserId:signer}});WORKFLOW.row.signingStatus='sent';WORKFLOW.row.signingSessionId=result.sessionId;alert(result.retried?'已使用同一份凍結合約重新送到 LINE 群組':'正式 PDF 已歸檔並送到 LINE 群組');WORKFLOW.detail=await apiV2('contracts/'+encodeURIComponent(WORKFLOW.contract.id));renderWorkflow();}catch(error){alert(error.message);}}
async function workflowComplete(){try{const result=await apiV2('signing-sessions/'+encodeURIComponent(WORKFLOW.row.signingSessionId)+'/confirm-complete',{method:'POST',body:{}});WORKFLOW.row.signingStatus='completed';alert('已完成我方確認；最終合約 PDF 與證據收據已封存。');renderWorkflow();}catch(error){alert(error.message);}}
load();
</script>
</body>
</html>`;
}
