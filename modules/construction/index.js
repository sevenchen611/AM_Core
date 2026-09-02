// AM Platform 模組:construction(工程領域,只有「工程」租戶啟用)
// ─────────────────────────────────────────────────────────────────────────
// 唯一擁有者:本資料夾由此 session 完整擁有,其他 session 不碰。
// 抽自 BuildAM 並重組成模組形狀(吃 ctx.tenant,功能等同):
//   回饋單/變更單狀態機(tickets.js:擱置/復活/催辦/公告)、budget.js、contracts.js(回寫預算)、
//   trades.js、SOP(sop.js)、工程儀表板(dashboard.js)、AI 初判(classify.js)、到期/擱置提醒(reminders.js)。
//   本 index.js 內聯授權殼(webRoute)並整合所有子檔;不依賴外部共用授權檔。
//
// 對外(見 default export 底部):
//   routes            — /dashboard、/budget、/contracts(頁面+API)、/tickets/api/*(單據 API)
//   createTicket      — 供 queue 的「開回饋單」
//   linkMessageToTicket / ticketAction / createChangeOrder / openTicketsForProject — 單據狀態機服務
//   listTrades        — 供 queue / budget 的工種清單
//   classify          — 供 triage(collect 之後)的 AI 初判分類器(空間/工項)
//   sopStages / readSop / writeSopCheck / listTickets / listChangeOrders / listProjects — 單據/SOP 資料
//   reminderPasses    — 供 reminders 每日班次呼叫的工程到期/擱置 pass
//   reminderSource    — 供 reminders 取「逾期/擱置」單據並回寫的低階來源
//
// 「多做的五件事」:
//   1. 租戶閘門:未啟用 construction 的租戶(含 ?tenant=別家)一律 404,不服務(webRoute / assertTenant)。
//   2. 權限鍵 per-tenant:am-<tenant>-budget / -contract / -<館別代碼>(scope)(見 resolveAuth)。
//   3. web routes 授權/scope 一律走 core.portal(resolveAuth),不信任前端原始參數(一律重算後注入 URL)。
//   4. 編號多租戶不撞號:用租戶專案的館別代碼 + 各租戶自己的庫序號(tickets.js / contracts.js)。
//   5. 狀態隔離:所有 Notion 存取經 deps.notionRequest(已鎖定該租戶 tenantKey)。

import { sendJson, queryAll, appendHistory, pageName } from './common.js';
import { listKnownTrades } from './trades.js';
import { handleBudgetRequest } from './budget.js';
import { handleContractsRequest } from './contracts.js';
import { createContractSigningWebHandler } from './contract-signing-web.js';
import { createContractDraftReviewWebHandler } from './contract-draft-review-web.js';
import { handleEngineeringContractPdfRender } from './contract-pdf-renderer.js';
import { createContractOutboxWorker } from './contract-outbox.js';
import {
  createRuntimeSigningService,
  loadContractPdf,
  saveContractIdentityDocuments,
  saveContractSignature,
  signingRequestMeta,
} from './contract-runtime.js';
import { SOP_STAGES, readSopState, writeSopCheck } from './sop.js';
import { handleDashboardRequest } from './dashboard.js';
import { handleTaskCardRequest } from './task-card.js';
import { classify, classifyPhoto } from './classify.js';
import { reminderPasses } from './reminders.js';
import {
  handleTicketsRequest, createTicket, linkMessageToTicket, ticketAction, createChangeOrder,
  listTickets, listChangeOrders, listProjects, openTicketsForProject,
} from './tickets.js';

let platform = null;
function init(injected) {
  platform = injected;
  // 跨模組 register 掛鉤(比照 tasks 掛 platform.tasks、queue 讀 platform.createFeedbackTicket):
  //   把領域分類器掛到平台共用把手,供 triage(通用初判管線)於 collect 之後呼叫。
  //   非工程租戶(未啟用 construction)一律回 null,不丟例外 → triage 走通用流程/不分類。
  platform.classify = async (ctx) => {
    const tenant = ctx && ctx.tenant;
    if (!tenant || !(tenant.modules || []).includes('construction')) return null;
    return classify(fullDeps(tenant), ctx);
  };
  // 照片領域掛載(給 media 的孤兒照片決定空間相簿)。非工程租戶一律回 null → media 走通用日期相簿。
  platform.classifyPhoto = async (ctx) => {
    const tenant = ctx && ctx.tenant;
    if (!tenant || !(tenant.modules || []).includes('construction')) return null;
    return classifyPhoto(fullDeps(tenant), ctx);
  };
  // 工程到期/擱置提醒 pass 註冊給 reminders(累加,前向相容其他領域模組日後也註冊)。
  //   reminders 於每日班次迭代呼叫;pass 對無回饋單庫的租戶(如森在)自身回 { skipped }。
  platform.reminderPasses = [...(platform.reminderPasses || []), ...reminderPasses];
  // 開立回饋單掛鉤(給 queue 的 /queue/api/create-ticket 委派)。ctx = { tenant, ...body };
  //   svcDeps 內含租戶閘門:非工程租戶會拋錯(queue 端另以 501 先擋,見 queue/index.js)。
  platform.createFeedbackTicket = (ctx) => createTicket(svcDeps(ctx), withVerifiedActor(ctx));
  // 工種清單掛鉤(給 queue 的 /queue/api/trades)。非工程租戶(如森在)容錯回 [],不丟例外。
  platform.listTrades = async (ctx) => {
    const tenant = ctx && ctx.tenant;
    if (!tenant || !(tenant.modules || []).includes('construction')) return [];
    return listKnownTrades(fullDeps(tenant));
  };
}

// 租戶設定已由 core/tenants.js 從 <PREFIX>_* 載入；模組不再直接讀 process.env。
function tenantQueueAccessKey(tenant) {
  return tenant.queueAccessKey || platform.queueAccessKey || '';
}

// 各專案 Google 行事曆(dashboard 內嵌用):由 core 掃 <PREFIX>_CAL_<館別代碼>。
function tenantCalendars(tenant) {
  return tenant.calendars || {};
}

// LINE 推播配額(dashboard 首屏用),以平台共用 lineGet 組出(比照 BuildAM)。
function makeGetLineQuota() {
  return async () => {
    const [quota, usage] = await Promise.all([
      platform.lineGet('/v2/bot/message/quota'),
      platform.lineGet('/v2/bot/message/quota/consumption'),
    ]);
    return { limit: quota.type === 'limited' ? quota.value : null, used: usage.totalUsage };
  };
}

// 依「現在服務的租戶」+ 平台共用能力,組出這次呼叫用的 deps(逐呼叫產生,無模組級全域)。
//   notionRequest 已鎖定該租戶 tenantKey(隔離守衛在 core);dataSources 取自 ctx.tenant。
function fullDeps(tenant) {
  const tenantAi = platform.aiForTenant?.(tenant) || tenant.ai || {};
  const deps = {
    tenant,
    tenantKey: tenant.key,
    notionRequest: (pathname, opts = {}) => platform.notionRequest(pathname, { ...opts, tenantKey: tenant.key }),
    uploadFileToNotion: platform.uploadFileToNotion,
    registerTenantDataSource: platform.registerTenantDataSource,
    dataSources: tenant.dataSources || {},
    queueAccessKey: tenantQueueAccessKey(tenant),
    driveConfigured: tenant.driveConfigured,
    driveRootFolderId: tenant.driveRootFolderId,
    pushLineMessage: platform.pushLineMessage,
    lineGet: platform.lineGet,
    verifyLiffIdentity: platform.verifyLiffIdentity,
    contractStore: platform.contractStore,
    uploadToDrive: platform.uploadToDrive,
    uploadDriveStream: platform.uploadDriveStream,
    downloadFromDrive: platform.downloadFromDrive,
    auditDrivePrivate: platform.auditDrivePrivate,
    getDriveAccessToken: platform.getDriveAccessToken,
    ensureDriveFolder: platform.ensureDriveFolder,
    // dashboard 用:專案行事曆對照 + LINE 推播配額
    calendars: tenantCalendars(tenant),
    getLineQuota: makeGetLineQuota(),
    publicBaseUrl: platform.publicBaseUrlForTenant?.(tenant) || tenant.publicBaseUrl || platform.publicBaseUrl || '',
    // classify(AI 初判)用;非工程/未配置金鑰時 classify 自動 no-op
    ai: {
      provider: tenantAi.provider || platform.aiProvider,
      anthropicApiKey: tenantAi.anthropicApiKey || platform.anthropicApiKey,
      minimaxApiKey: tenantAi.minimaxApiKey || platform.minimaxApiKey,
      minimaxBaseUrl: tenantAi.minimaxBaseUrl || platform.minimaxBaseUrl,
      judgeModel: tenantAi.judgeModel || platform.aiJudgeModel,
    },
  };
  deps.listTrades = () => listKnownTrades(deps);
  return deps;
}

// 租戶閘門:非「有啟用 construction」的租戶,服務一律拒絕(避免 ctx.tenant 指到未啟用租戶)。
function assertTenant(tenant) {
  if (!tenant) throw new Error('construction service requires ctx.tenant');
  if (!(tenant.modules || []).includes('construction')) throw new Error(`租戶 ${tenant.key} 未啟用工程模組`);
  return tenant;
}

function svcDeps(ctx) {
  const deps = fullDeps(assertTenant(ctx && ctx.tenant));
  deps.access = ctx?.access || null;
  deps.actor = ctx?.access?.actor || '';
  return deps;
}

function withVerifiedActor(ctx = {}) {
  return ctx.access ? { ...ctx, operator: ctx.access.actor } : ctx;
}

// ── web 授權(走 core.portal;權限鍵 per-tenant)────────────────
// 回傳租戶與工程功能權限；合約權限採 view/manage/issue/confirm/admin 分層。
//   scope:null=全部;'none'=無;否則逗號分隔的館別代碼(am-<key>-<code>)。PIN/owner=全部。
async function resolveAuth(portal, tenant, req, providedAccess = null) {
  const k = tenant.key;
  const access = providedAccess || await portal.resolveAccess(req, tenant);
  const user = access?.user || null;
  const feats = Array.isArray(user?.allowedFeatures) ? user.allowedFeatures : [];
  const userOwner = user?.role === 'owner';       // Portal owner(真身分)
  const isOwner = Boolean(access?.isPlatformOwner);
  const authed = Boolean(access?.allowed);
  const granted = (feature) => typeof portal.featureGranted === 'function'
    ? portal.featureGranted(user, tenant, feature)
    : feats.includes(`am-${k}-${feature}`);

  let scope = null;
  if (user && !isOwner) {
    scope = typeof portal.tenantScope === 'function' ? portal.tenantScope(user, tenant) : 'none';
  }
  return {
    authed,
    isOwner,
    // 預算/合約權限特別分開:PIN 通行碼一律看不到,僅 Portal owner 或被授者(比照 BuildAM)。
    canBudget: userOwner || granted('budget'),
    // 舊的 contract 授權在遷移期等同 view + manage；簽發、確認與管理仍須明確授權。
    canContract: userOwner || granted('contract') || granted('contract-view'),
    canContractManage: userOwner || granted('contract') || granted('contract-manage'),
    canContractIssue: userOwner || granted('contract-issue'),
    canContractConfirm: userOwner || granted('contract-confirm'),
    canContractAdmin: userOwner || granted('contract-admin'),
    scope,
    access,
  };
}

function unauthPage() {
  return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>需登入</title>
<style>body{font-family:system-ui,'Noto Sans TC',sans-serif;background:#f5f7f6;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#22302a}
div{background:#fff;border:1px solid #e0e6e3;border-radius:16px;padding:28px;text-align:center;max-width:320px}
h1{font-size:17px;color:#2e7d52;margin:0 0 10px}p{font-size:13px;color:#6b7a72;line-height:1.7;margin:0}</style></head>
<body><div><h1>🔒 需登入</h1><p>請透過 AM Portal 登入後再進入本頁。</p></div></body></html>`;
}

// web route 外殼(內聯 serveConstruction):租戶閘門 → portal 認證 → 重算並注入 key/budget/contract/scope
//   → 委派子功能 handler(req, res, pathname, url, deps)。
function webRoute(handler) {
  return async (req, res, ctx) => {
    const tenant = ctx.tenant;
    if (!tenant || !(tenant.modules || []).includes('construction')) {
      return sendJson(res, 404, { error: 'Not found' });
    }
    const auth = await resolveAuth(ctx.portal, tenant, req, ctx.access);
    if (!auth.authed) {
      if (/\/api\//.test(ctx.pathname)) return sendJson(res, 401, { error: '需登入' });
      res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(unauthPage());
    }
    // 工程儀表板的專案卡片與每個專案 API 都會再依 Portal 的館別 scope
    // 過濾；不能把擁有工程 AM 系統權限誤當成可看全部館別。
    const deps = fullDeps(tenant);
    deps.access = auth.access;
    deps.actor = auth.access?.actor || '';
    // 一律以 portal 重算的授權覆蓋 URL(不信任前端傳入的 key/budget/contract/scope)。
    const url = new URL(ctx.url.href);
    url.searchParams.set('key', deps.queueAccessKey || '');
    url.searchParams.delete('budget');
    url.searchParams.delete('contract');
    url.searchParams.delete('contractManage');
    url.searchParams.delete('contractIssue');
    url.searchParams.delete('contractConfirm');
    url.searchParams.delete('contractAdmin');
    url.searchParams.delete('scope');
    if (auth.canBudget) url.searchParams.set('budget', '1');
    if (auth.canContract) url.searchParams.set('contract', '1');
    if (auth.canContractManage) url.searchParams.set('contractManage', '1');
    if (auth.canContractIssue) url.searchParams.set('contractIssue', '1');
    if (auth.canContractConfirm) url.searchParams.set('contractConfirm', '1');
    if (auth.canContractAdmin) url.searchParams.set('contractAdmin', '1');
    const projectScopedCapability = ['construction.read', 'construction.budget', 'construction.contracts'].includes(ctx.routeAccess?.capability);
    if (projectScopedCapability && auth.scope != null) url.searchParams.set('scope', auth.scope);
    return handler(req, res, ctx.pathname, url, deps);
  };
}

async function publicContractSigningRoute(req, res, ctx) {
  const tenant = ctx.tenant;
  if (!tenant || tenant.key !== 'engineering' || !(tenant.modules || []).includes('construction')) return sendJson(res, 404, { error: 'Not found' });
  try {
    const deps = fullDeps(tenant);
    const service = createRuntimeSigningService(deps);
    const handler = createContractSigningWebHandler({
      service,
      liffId: tenant.config?.contracts?.liffId,
      getRequestMeta: signingRequestMeta,
      resolveDocumentUrl: async () => '/contract-sign/api/document',
      loadDocument: async (opened) => loadContractPdf(deps, opened, {
        signingState: opened.partyASigned ? await service.getSession(opened.sessionId) : null,
      }),
      saveSignature: async ({ sessionId, bytes, contentType }) => {
        const saved = await saveContractSignature(deps, { sessionId, buffer: bytes, contentType });
        return { hash: saved.signatureHash, ref: saved.submissionRef };
      },
      saveIdentityDocuments: async ({ sessionId, front, back }) => saveContractIdentityDocuments(
        deps,
        { sessionId, front, back },
      ),
      logger: platform.logger || console,
    });
    return handler(req, res, ctx.pathname, ctx.url);
  } catch (error) {
    const status = Number(error.statusCode || error.status) || 503;
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.end('<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>工程合約簽署</title><body><p>工程合約簽署服務尚未就緒，請聯繫工程 AM 管理員。</p></body></html>');
  }
}

async function publicContractDraftReviewRoute(req, res, ctx) {
  const tenant = ctx.tenant;
  if (!tenant || tenant.key !== 'engineering' || !(tenant.modules || []).includes('construction')) return sendJson(res, 404, { error: 'Not found' });
  try {
    const deps = fullDeps(tenant);
    return createContractDraftReviewWebHandler(deps)(req, res, ctx.pathname);
  } catch (error) {
    const status = Number(error.statusCode || error.status) || 503;
    return sendJson(res, status, { error: status >= 500 ? '草約審閱服務尚未就緒' : String(error.message || '操作失敗') });
  }
}

// 供 reminders(M6)取「逾期/擱置」單據並回寫;回傳綁定該租戶的一組低階助手。
function reminderSource(ctx) {
  const deps = svcDeps(ctx);
  const ds = deps.dataSources.feedbackTickets;
  return {
    feedbackTicketsDataSource: ds,
    async listActiveTickets() {
      if (!ds) return [];
      return queryAll(deps, ds, { and: [
        { property: '回覆期限', date: { is_not_empty: true } },
        { or: [
          { property: '狀態', select: { equals: '開立' } },
          { property: '狀態', select: { equals: '回覆中' } },
        ] },
      ] });
    },
    async listParkedTickets() {
      if (!ds) return [];
      return queryAll(deps, ds, { property: '狀態', select: { equals: '擱置(待時機)' } });
    },
    patchTicket: (id, properties) => deps.notionRequest(`/v1/pages/${encodeURIComponent(id)}`, { method: 'PATCH', body: { properties } }),
    appendTicketHistory: (id, content) => appendHistory(deps, id, content),
    pageName: (id) => pageName(deps, id),
    pushLineMessage: deps.pushLineMessage,
  };
}

// PostgreSQL outbox 是 LINE 邀請與 Notion 投影的權威重試佇列。排程只在工程租戶且
// schema 已就緒時執行；簽署總開關關閉期間仍可補齊 Notion 投影，但絕不送出新邀請。
async function tick(ctx = {}) {
  const tenant = assertTenant(ctx.tenant);
  if (tenant.key !== 'engineering') return { skipped: 'not-engineering-tenant' };
  const deps = fullDeps(tenant);
  const state = await deps.contractStore?.status?.(tenant);
  if (!state?.configured || !state?.schemaReady) return { skipped: 'contract-store-not-ready' };

  const eventKinds = ['notion_contract_projection'];
  if (tenant.config?.contracts?.signingEnabled === true) eventKinds.unshift('line_signing_invitation');
  const worker = createContractOutboxWorker(deps, { workerId: 'engineering-contract-scheduler' });
  return worker.drain({
    tenant,
    actor: 'engineering-contract-outbox',
    scope: { all: true },
  }, { limit: 10, eventKinds });
}

// ── 模組契約:預設匯出 ─────────────────────────────────────
export default {
  name: 'construction',
  init,
  routes: [
    { prefix: '/internal/v1/engineering-contracts/render', method: 'POST', tenantKey: 'engineering', access: { kind: 'public', capability: 'construction.contract-pdf-render' }, handler: handleEngineeringContractPdfRender },
    { prefix: '/contract-sign', tenantKey: 'engineering', access: { kind: 'public', capability: 'construction.contract-sign' }, handler: publicContractSigningRoute },
    { prefix: '/contract-review', tenantKey: 'engineering', access: { kind: 'public', capability: 'construction.contract-review' }, handler: publicContractDraftReviewRoute },
    { prefix: '/task', access: { kind: 'tenant', capability: 'construction.read' }, handler: webRoute(handleTaskCardRequest) },
    { prefix: '/dashboard', access: { kind: 'tenant', capability: 'construction.read' }, handler: webRoute(handleDashboardRequest) },
    { prefix: '/budget', access: { kind: 'tenant', capability: 'construction.budget' }, handler: webRoute(handleBudgetRequest) },
    { prefix: '/contracts', access: { kind: 'tenant', capability: 'construction.contracts' }, handler: webRoute(handleContractsRequest) },
    { prefix: '/tickets', access: { kind: 'group', capability: 'construction.tickets' }, handler: webRoute(handleTicketsRequest) },
  ],

  // 供 queue 的「開回饋單」與單據狀態機(ctx 帶 { tenant, ...body })
  createTicket: (ctx) => createTicket(svcDeps(ctx), withVerifiedActor(ctx)),
  linkMessageToTicket: (ctx) => linkMessageToTicket(svcDeps(ctx), withVerifiedActor(ctx)),
  ticketAction: (ctx) => ticketAction(svcDeps(ctx), withVerifiedActor(ctx)),
  createChangeOrder: (ctx) => createChangeOrder(svcDeps(ctx), withVerifiedActor(ctx)),
  openTicketsForProject: (ctx) => openTicketsForProject(svcDeps(ctx), ctx.projectId),
  listTrades: (ctx) => listKnownTrades(svcDeps(ctx)),

  // 供 triage 的 AI 初判分類器(空間/工項);非工程/未配置金鑰 → 回 null
  classify: (ctx) => classify(svcDeps(ctx), ctx),
  classifyPhoto: (ctx) => classifyPhoto(svcDeps(ctx), ctx),

  // 供 dashboard 呈現用的資料(SOP/單據)
  sopStages: SOP_STAGES,
  readSop: (ctx) => readSopState(svcDeps(ctx), ctx.projectId),
  writeSopCheck: (ctx) => writeSopCheck(svcDeps(ctx), ctx.projectId, ctx.itemId, ctx.checked),
  listTickets: (ctx) => listTickets(svcDeps(ctx), ctx.scope ?? null),
  listChangeOrders: (ctx) => listChangeOrders(svcDeps(ctx), ctx.scope ?? null),
  listProjects: (ctx) => listProjects(svcDeps(ctx), ctx.scope ?? null),

  // 供 reminders 的工程到期/擱置:高階 pass(reminders.js)+ 低階單據來源
  reminderPasses,
  reminderSource,
  tick,
};

// 測試用內部匯出(不影響正式流程)
export const __test = { fullDeps, assertTenant, resolveAuth };
