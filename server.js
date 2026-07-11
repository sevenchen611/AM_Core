// AM Platform 伺服器入口(ESM、無框架 node:http,比照 BuildAM)
// 一支 OA → 一個 webhook(/webhook/line)是唯一入口 → 依群組分流到各租戶 → 各租戶落自己的 Notion 頁。
// core 只做底座 + 路由 + 租戶解析 + 隔離;功能邏輯全在 modules/。

import http from 'node:http';
import { bootstrap } from './core/bootstrap.js';
import { sendJson, sendText, readBody } from './core/util.js';

const ctx = await bootstrap(process.env);
const { tenants, line, router, dispatcher, portal, modules, platform, llm, logger } = ctx;
const queueAccessKey = process.env.AMCORE_QUEUE_ACCESS_KEY || process.env.BUILD_QUEUE_ACCESS_KEY || '';

if (!line.configured) logger.warn('Missing LINE_CHANNEL_ACCESS_TOKEN or LINE_CHANNEL_SECRET — webhook signature will fail.');
for (const t of tenants) {
  if (!t.notionConfigured) logger.warn(`Tenant "${t.key}" not Notion-ready (need <${t.envPrefix}>_NOTION_PARENT_PAGE_ID + messages + groupBindings data source ids).`);
}

const routes = dispatcher.collectRoutes();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  // ── 健康檢查:平台 + 各租戶設定狀態 ──
  if (req.method === 'GET' && (pathname === '/health' || pathname === '/')) {
    return sendJson(res, 200, {
      ok: true,
      platform: 'am-core',
      build: 'audio-header-sniff-2026-07-11', // 部署版本標記:用來確認正式站跑的是哪一版
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
      })),
      dataIsolationGuardEnabled: true,
      webRoutes: routes.map((r) => `${r.tenantKey}:${r.moduleName}`),
    });
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
  for (const { tenantKey, route } of routes) {
    const matched = typeof route.match === 'function' ? route.match(pathname)
      : route.prefix ? (pathname === route.prefix || pathname.startsWith(`${route.prefix}/`))
        : false;
    if (!matched) continue;
    if (route.method && route.method !== req.method) continue;
    // 租戶:以 ?tenant=key 指定(需在登記內),否則用該 route 的擁有租戶。
    const requested = url.searchParams.get('tenant');
    const tenant = tenants.find((t) => t.key === (requested || tenantKey)) || null;
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
setInterval(() => {
  dispatcher.runTicks().catch((error) => logger.warn('Scheduled tick failed:', error.message));
}, 10 * 60 * 1000);

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  logger.log(`AM Platform listening on port ${port}. Tenants: ${tenants.map((t) => t.key).join(', ') || '(none)'}.`);
});
