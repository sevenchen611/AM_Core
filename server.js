// AM Platform 伺服器入口(ESM、無框架 node:http,比照 BuildAM)
// 一支 OA → 一個 webhook(/webhook/line)是唯一入口 → 依群組分流到各租戶 → 各租戶落自己的 Notion 頁。
// core 只做底座 + 路由 + 租戶解析 + 隔離;功能邏輯全在 modules/。

import http from 'node:http';
import { bootstrap } from './core/bootstrap.js';
import { sendJson, sendText, readBody } from './core/util.js';

const ctx = await bootstrap(process.env);
const { tenants, line, router, dispatcher, portal, modules, platform, llm, logger } = ctx;
const queueAccessKey = process.env.AMCORE_QUEUE_ACCESS_KEY || '';

if (!line.configured) logger.warn('Missing LINE_CHANNEL_ACCESS_TOKEN or LINE_CHANNEL_SECRET — webhook signature will fail.');
for (const t of tenants) {
  if (!t.notionConfigured) logger.warn(`Tenant "${t.key}" not Notion-ready (need <${t.envPrefix}>_NOTION_PARENT_PAGE_ID + messages + groupBindings data source ids).`);
}

const routes = dispatcher.collectRoutes();

const html = (value) => String(value || '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));
function homeTenant(url) {
  const requested = url.searchParams.get('tenant') || process.env.AMCORE_HOME_TENANT || '';
  return tenants.find((t) => t.key === requested)
    || tenants.find((t) => (t.modules || []).includes('construction'))
    || tenants[0]
    || null;
}
function homeLocation(tenant) {
  const configured = String(tenant?.config?.homeRoute || '').trim();
  const route = configured.startsWith('/') ? configured : (tenant?.modules || []).includes('construction') ? '/dashboard' : '/queue';
  return `${route}${route.includes('?') ? '&' : '?'}tenant=${encodeURIComponent(tenant.key)}`;
}
function renderLoginPage(tenant, error = false) {
  return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${html(tenant.displayName)}｜AM Platform</title><style>
body{font-family:system-ui,'Noto Sans TC',sans-serif;background:#f5f7f6;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#22302a}
form{background:#fff;border:1px solid #e0e6e3;border-radius:16px;padding:28px;text-align:center;width:300px;box-shadow:0 8px 30px rgba(20,50,35,.08)}
h1{font-size:19px;color:#2e7d52;margin:0 0 5px}.sub{font-size:12px;color:#6b7a72;margin:0 0 16px}input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #d8e1dd;border-radius:10px;font-size:16px;text-align:center}
button{width:100%;margin-top:12px;padding:12px;background:#2e7d52;color:#fff;border:0;border-radius:10px;font-size:15px;font-weight:700}.err{color:#a03e33;font-size:13px;margin-top:9px}</style></head>
<body><form method="POST" action="/auth"><h1>🐌 ${html(tenant.displayName)}</h1><p class="sub">AM Platform 統一入口</p>
<input type="hidden" name="tenant" value="${html(tenant.key)}"><input name="pin" type="password" placeholder="輸入通行碼" autofocus><button>進入</button>
${error ? '<div class="err">通行碼不正確</div>' : ''}</form></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  // ── 健康檢查:平台 + 各租戶設定狀態 ──
  if (req.method === 'GET' && pathname === '/health') {
    return sendJson(res, 200, {
      ok: true,
      platform: 'am-core',
      build: 'group-member-picker-2026-07-17b',
      lineConfigured: line.configured,
      driveConfigured: platform.driveConfigured,
      llm: { available: llm.available, chain: llm.backends },
      tenants: tenants.map((t) => ({
        key: t.key,
        displayName: t.displayName,
        notionConfigured: t.notionConfigured,
        groupRoutingEnabled: Boolean(t.dataSources.groupBindings),
        driveConfigured: t.driveConfigured,
        dataSources: Object.keys(t.dataSources),
        modulesRequested: t.modules,
        modulesLoaded: t.modules.filter((m) => modules.has(m)),
        homeRoute: t.config?.homeRoute || null,
        aiJudgeEnabled: Boolean(t.ai?.provider && t.ai?.judgeModel
          && (t.ai?.minimaxApiKey || t.ai?.anthropicApiKey)),
        llmAvailable: Boolean(platform.llmForTenant?.(t)?.available),
      })),
      dataIsolationGuardEnabled: true,
      webRoutes: routes.map((r) => `${r.tenantKey}:${r.moduleName}`),
    });
  }

  // Portal 帳號管理用的公開租戶目錄：只提供非機密的 key／顯示名稱／權限鍵。
  // 工程租戶可指定既有 feature alias，避免 BuildAM 與工程 AM 在權限清單重複出現。
  if (req.method === 'GET' && pathname === '/portal/tenants') {
    const directory = tenants.map((tenant) => {
      const portalConfig = tenant.config?.portal || {};
      const aliases = Array.isArray(portalConfig.featureAliases) ? portalConfig.featureAliases : [];
      const featureKey = aliases.find((key) => /^am-[a-z0-9_-]+$/i.test(key)) || `am-${tenant.key}`;
      return {
        key: tenant.key,
        featureKey,
        label: String(portalConfig.label || `${tenant.displayName} AM`).slice(0, 120),
      };
    });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': 'https://rental.hozorental.com',
      'Cache-Control': 'no-store',
    });
    return res.end(JSON.stringify({ tenants: directory }));
  }

  // ── 平台首頁：承接原工程後台網址，同時保留 tenant-aware 登入 ──
  if (req.method === 'GET' && pathname === '/') {
    const tenant = homeTenant(url);
    if (!tenant) return sendJson(res, 503, { error: 'No tenant configured' });
    const pin = portal.pinAuthed(req, tenant);
    const user = pin ? null : await portal.userAuthed(req);
    if (pin || portal.tenantAuthorized(user, tenant)) {
      res.writeHead(302, { Location: homeLocation(tenant), 'Cache-Control': 'no-store' });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(renderLoginPage(tenant));
  }

  // Portal 跨網域登入交接：短效 token 只能由 Portal 已登入帳號取得；
  // 平台消費後簽發自己的 HttpOnly session cookie，再導向乾淨網址。
  if (req.method === 'GET' && pathname === '/portal/sso') {
    const tenant = tenants.find((t) => t.key === url.searchParams.get('tenant')) || null;
    const token = String(url.searchParams.get('token') || '');
    if (!tenant || !token) return sendJson(res, 400, { error: 'Invalid Portal SSO handoff.' });
    const user = await portal.consumeHandoff(token, tenant);
    const cookie = user ? portal.ssoCookieHeader(user) : '';
    if (!user || !cookie) return sendJson(res, 401, { error: 'Portal authorization failed.' });
    res.writeHead(302, { Location: homeLocation(tenant), 'Set-Cookie': cookie, 'Cache-Control': 'no-store' });
    return res.end();
  }

  if (req.method === 'POST' && pathname === '/auth') {
    const form = new URLSearchParams(await readBody(req));
    const tenant = tenants.find((t) => t.key === form.get('tenant')) || homeTenant(url);
    if (!tenant) return sendJson(res, 503, { error: 'No tenant configured' });
    if (portal.checkPin(String(form.get('pin') || '').trim(), tenant)) {
      res.writeHead(302, { Location: homeLocation(tenant), 'Set-Cookie': portal.pinCookieHeader(tenant), 'Cache-Control': 'no-store' });
      return res.end();
    }
    res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(renderLoginPage(tenant, true));
  }

  // ── 巡邏排程觸發(外部 cron 呼叫)──
  if (pathname === '/cron/tick') {
    if (!queueAccessKey || url.searchParams.get('key') !== queueAccessKey) {
      return sendJson(res, 401, { error: 'Unauthorized' });
    }
    try {
      await dispatcher.runTicks();
      return sendJson(res, 200, { ok: true });
    } catch (error) {
      logger.error('Tick run failed:', error);
      return sendJson(res, 500, { error: error.message });
    }
  }

  // ── LINE webhook(唯一入口)──
  if (req.method === 'POST' && pathname === '/webhook/line') {
    const rawBody = await readBody(req);
    if (!line.isValidSignature(rawBody, req.headers['x-line-signature'])) {
      return sendJson(res, 401, { error: 'Invalid signature' });
    }
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch (error) {
      logger.error('Unable to parse LINE webhook body:', error);
      return sendJson(res, 400, { error: 'Invalid JSON' });
    }
    sendText(res, 200, 'OK'); // 先回 200,事件背景處理(比照 BuildAM)
    Promise.all((body.events || []).map((event) => handleEvent(event)))
      .catch((error) => logger.error('Unable to process LINE webhook events:', error));
    return;
  }

  // ── 模組 web routes(佇列 / 儀表板 …)──
  for (const { tenantKey, moduleName, route } of routes) {
    const matched = typeof route.match === 'function' ? route.match(pathname)
      : route.prefix ? (pathname === route.prefix || pathname.startsWith(`${route.prefix}/`))
        : false;
    if (!matched) continue;
    if (route.method && route.method !== req.method) continue;
    // 租戶:以 ?tenant=key 指定(需在登記內),否則用該 route 的擁有租戶。
    const requested = url.searchParams.get('tenant');
    const tenant = tenants.find((t) => t.key === (requested || tenantKey)) || null;
    if (tenant && !(tenant.modules || []).includes(moduleName)) continue;
    return route.handler(req, res, { pathname, url, tenant, tenants, portal, platform });
  }

  return sendJson(res, 404, { error: 'Not found' });
});

// 收到一則事件 → 解析租戶/綁定 → 交分派器。未綁定 = 不落庫、不回話(照 BuildAM)。
async function handleEvent(event) {
  if (event.type !== 'message' || !event.message) return;
  const groupId = event.source?.groupId || event.source?.roomId || '';
  const { tenant, binding } = await router.resolveGroupBinding(groupId);
  if (!tenant) {
    logger.log(`Unbound message ${event.message.id} (group=${groupId || 'direct'}) — ignored.`);
    return;
  }
  await dispatcher.dispatchMessage({ tenant, binding, event });
}

// 巡邏排程:每 10 分鐘跑一次 tick(模組如 reminders 用)。
const tickTimer = setInterval(() => {
  dispatcher.runTicks().catch((error) => logger.warn('Scheduled tick failed:', error.message));
}, 10 * 60 * 1000);
tickTimer.unref?.();

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  logger.log(`AM Platform listening on port ${port}. Tenants: ${tenants.map((t) => t.key).join(', ') || '(none)'}.`);
});
