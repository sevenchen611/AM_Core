// AM Platform core — 組裝
// 從 env 建立:租戶登記 + 資料源隔離登記 + 共用能力(notion/line/drive/portal)+ 路由器 + 分派器。
// server.js 用真憑證呼叫;dryrun 測試харness 可用 overrides 注入 mock(不打真 API)。

import { loadTenants, buildDataSourceRegistry } from './tenants.js';
import { createNotion } from './notion.js';
import { createLine } from './line.js';
import { createDrive } from './drive.js';
import { createPortal } from './portal.js';
import { createLlm } from './llm.js';
import { createOperationalMemory } from './operational-memory.js';
import { createRouter } from './router.js';
import { loadModules, createDispatcher } from './modules.js';

function createCalendarIntegration(env, logger = console) {
  const baseUrl = String(env.HOZO_RENTAL_CALENDAR_BASE_URL || env.HOZO_RENTAL_BASE_URL || 'https://rental.hozorental.com').trim().replace(/\/+$/, '');
  const token = String(env.HOZO_RENTAL_CALENDAR_MACHINE_TOKEN || '').trim();
  const configured = token.length >= 32 && /^https:\/\//i.test(baseUrl);

  async function post(pathname, body, idempotencyKey = '') {
    if (!configured) return { ok: false, status: 503, error: 'Calendar integration is not configured.' };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(`${baseUrl}${pathname}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      return { ...payload, ok: response.ok && payload?.ok !== false, status: response.status };
    } catch (error) {
      logger.warn?.(`Calendar integration request failed (${pathname}): ${error.message}`);
      return { ok: false, status: 503, error: 'Calendar integration unavailable.' };
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    configured,
    consumeBinding: ({ tenantKey, code, lineUserId, idempotencyKey }) => post(
      '/api/integrations/calendar/line-bindings/consume',
      { tenantKey, code, lineUserId },
      idempotencyKey,
    ),
    resolveIdentity: ({ tenantKey, lineUserId }) => post(
      '/api/integrations/calendar/identity/resolve',
      { tenantKey, lineUserId },
    ),
    queryPersonalItems: ({ tenantKey, lineUserId, fromDate, toDate, includeClosed = false }) => post(
      '/api/integrations/calendar/personal-items/query',
      { tenantKey, lineUserId, fromDate, toDate, includeClosed },
    ),
    createPersonalItem: ({ tenantKey, lineUserId, item, idempotencyKey }) => post(
      '/api/integrations/calendar/personal-items/create',
      { tenantKey, lineUserId, ...item },
      idempotencyKey,
    ),
    updatePersonalItem: ({ tenantKey, lineUserId, update, idempotencyKey }) => post(
      '/api/integrations/calendar/personal-items/update',
      { tenantKey, lineUserId, ...update },
      idempotencyKey,
    ),
    upsertSourceItem: ({ item, idempotencyKey }) => post(
      '/api/integrations/calendar/items/upsert',
      item,
      idempotencyKey,
    ),
  };
}

export async function bootstrap(env = process.env, overrides = {}) {
  const logger = overrides.logger || console;

  const tenants = overrides.tenants || loadTenants(env, logger);
  const registry = buildDataSourceRegistry(tenants, logger);

  // ── 共用能力(所有租戶相同的接線)──
  const notion = overrides.notion || createNotion({
    token: env.NOTION_TOKEN,
    version: env.NOTION_VERSION || '2025-09-03',
    registry,
    logger,
  });
  const line = overrides.line || createLine({
    channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: env.LINE_CHANNEL_SECRET,
    logger,
  });
  const drive = overrides.drive || createDrive({
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    refreshToken: env.GOOGLE_OAUTH_REFRESH_TOKEN,
    logger,
  });
  const portal = overrides.portal || createPortal({
    queueAccessKey: env.AMCORE_QUEUE_ACCESS_KEY || '',
    portalServiceToken: env.AMCORE_PORTAL_SERVICE_TOKEN || '',
    portalPin: env.AMCORE_PORTAL_PIN || '',
    meEndpoint: env.AMCORE_PORTAL_ME_ENDPOINT || 'https://rental.hozorental.com/api/me',
    handoffEndpoint: env.AMCORE_PORTAL_HANDOFF_ENDPOINT || 'https://rental.hozorental.com/api/am-sso/consume',
    verifyEndpoint: env.AMCORE_PORTAL_VERIFY_ENDPOINT || 'https://rental.hozorental.com/api/am-sso/verify',
    portalServiceToken: env.AMCORE_PORTAL_SERVICE_TOKEN || '',
    groupAuthzMode: env.AMCORE_GROUP_AUTHZ_MODE || 'shadow',
    emergencyPinEnabled: env.AMCORE_ENABLE_EMERGENCY_PIN === '1',
    emergencyPinTtlSeconds: env.AMCORE_EMERGENCY_PIN_TTL_SECONDS || 15 * 60,
    logger,
  });
  // LLM 抽象層:可插拔後端 + 統一備援鏈(鏈序見 AMCORE_LLM_CHAIN)。
  const llm = overrides.llm || createLlm({ env, logger });
  const operationalMemory = overrides.operationalMemory || createOperationalMemory({
    env,
    logger,
    poolFactory: overrides.operationalMemoryPoolFactory || null,
  });
  const calendarIntegration = overrides.calendarIntegration || createCalendarIntegration(env, logger);
  const tenantLlms = new Map();
  if (!overrides.llm) {
    for (const tenant of tenants) {
      const ai = tenant.ai || {};
      tenantLlms.set(tenant.key, createLlm({
        env: {
          ...env,
          ANTHROPIC_API_KEY: ai.anthropicApiKey || '',
          ASSEMBLYAI_API_KEY: ai.assemblyKey || '',
          GEMINI_API_KEY: ai.geminiKey || '',
          MINIMAX_API_KEY: ai.minimaxApiKey || '',
          MINIMAX_MODEL: tenant.config?.llm?.minimaxModel || ai.minimaxModel || ai.judgeModel || env.MINIMAX_MODEL,
          MINIMAX_API_BASE_URL: ai.minimaxBaseUrl || env.MINIMAX_API_BASE_URL,
          AMCORE_LLM_CHAIN_CHEAP: tenant.config?.llm?.cheapChain || env.AMCORE_LLM_CHAIN_CHEAP,
          AMCORE_AI_PROVIDER: ai.provider || env.AMCORE_AI_PROVIDER,
          AMCORE_AI_JUDGE_MODEL: ai.judgeModel || env.AMCORE_AI_JUDGE_MODEL,
        },
        logger,
      }));
    }
  }

  // 注入模組 init(platform) 的共用能力包(比照 BuildAM 各 init 的聯集,平台級一份)。
  const platform = {
    logger,
    // Notion(per-tenant 隔離守衛內建)
    notionRequest: notion.notionRequest,
    uploadFileToNotion: notion.uploadFileToNotion,
    registerTenantDataSource: notion.registerTenantDataSource,
    // LINE(共用 OA)
    pushLineMessage: line.pushLineMessage,
    replyLineMessages: line.replyLineMessages,
    replyLineMessage: line.replyLineMessage,
    lineConfigured: line.configured,
    lineGet: line.lineGet,
    listGroupMemberIds: line.listGroupMemberIds,
    resolveGroupMemberName: line.resolveGroupMemberName,
    resolveGroupName: line.resolveGroupName,
    downloadLineContent: line.downloadLineContent,
    peekLineContent: line.peekLineContent,
    streamLineContent: line.streamLineContent,
    resolveSenderName: line.resolveSenderName,
    resolveLineFilename: line.resolveLineFilename,
    // Drive(全域憑證,目標資料夾由租戶決定)
    drive,
    driveConfigured: drive.configured,
    ensureDriveFolder: drive.ensureFolder,
    uploadToDrive: drive.upload,
    uploadDriveStream: drive.uploadStream, // (stream, filename, contentType, folderId, size) 大檔串流留底
    getDriveAccessToken: drive.getAccessToken,
    // Portal 授權(web routes 用)
    portal,
    authzMode: portal.authzMode,
    queueAccessKey: env.AMCORE_QUEUE_ACCESS_KEY || '',
    // Dedicated narrow key for HOZO Rental to send text into the HOZO company LINE group.
    rentalCompanyGroupPushKey: env.HZ2_RENTAL_COMPANY_GROUP_PUSH_KEY || env.HOZO_RENTAL_COMPANY_GROUP_PUSH_KEY || '',
    // Dedicated AM→Rental Calendar identity integration. Secrets are never exposed to modules.
    calendarIntegrationConfigured: calendarIntegration.configured,
    calendarBindingConsume: calendarIntegration.consumeBinding,
    calendarIdentityResolve: calendarIntegration.resolveIdentity,
    calendarPersonalQuery: calendarIntegration.queryPersonalItems,
    calendarPersonalCreate: calendarIntegration.createPersonalItem,
    calendarPersonalUpdate: calendarIntegration.updatePersonalItem,
    calendarSourceUpsert: calendarIntegration.upsertSourceItem,
    // LLM(統一備援鏈)。新模組一律用這個,不要自己接 AI 供應商。
    llm,
    operationalMemory,
    llmForTenant: (tenant) => tenantLlms.get(tenant?.key) || llm,
    aiForTenant: (tenant) => tenant?.ai || {
      provider: (env.AMCORE_AI_PROVIDER || '').toLowerCase(),
      judgeModel: env.AMCORE_AI_JUDGE_MODEL || '',
      anthropicApiKey: env.ANTHROPIC_API_KEY || '',
      assemblyKey: env.ASSEMBLYAI_API_KEY || '',
      geminiKey: env.GEMINI_API_KEY || '',
      meetingModel: env.AMCORE_MEETING_MODEL || 'gemini-2.5-flash',
      minimaxApiKey: env.MINIMAX_API_KEY || '',
      minimaxBaseUrl: (env.MINIMAX_API_BASE_URL || 'https://api.minimax.io/v1').replace(/\/+$/, ''),
    },
    // AI 金鑰(共用;meetings 等模組於 init 取用)
    // ⚠️ 逐步退場:新程式請改用 platform.llm,金鑰只留給尚未遷移的模組與非 LLM 服務(AssemblyAI)。
    anthropicApiKey: env.ANTHROPIC_API_KEY || '',
    assemblyKey: env.ASSEMBLYAI_API_KEY || '',
    geminiKey: env.GEMINI_API_KEY || '',
    geminiModel: env.AMCORE_MEETING_MODEL || 'gemini-2.5-flash',
    minimaxApiKey: env.MINIMAX_API_KEY || '',
    minimaxBaseUrl: (env.MINIMAX_API_BASE_URL || 'https://api.minimax.io/v1').replace(/\/+$/, ''),
    aiProvider: (env.AMCORE_AI_PROVIDER || '').toLowerCase(),
    aiJudgeModel: env.AMCORE_AI_JUDGE_MODEL || '',
    // 自架「公開會議頁」:免 Notion 帳號、連結可轉傳(GET /m/<id>-<簽章>,由 meetings 模組 routes 提供)。
    // 沒設 AMCORE_PUBLIC_BASE_URL → publicBaseUrl='' → meetings 不產公開連結(與現況一致,安全)。
    // 簽章密鑰沿用 queueAccessKey,確保「產連結」與「驗連結」用同一把鑰匙。
    publicBaseUrl: (env.AMCORE_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, ''),
    publicBaseUrlForTenant: (tenant) => tenant?.publicBaseUrl || (env.AMCORE_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, ''),
    publicLinkSecret: env.AMCORE_QUEUE_ACCESS_KEY || '',
    // Preserve links issued with a tenant-specific key during the platform cutover.
    publicLinkSecrets: [...new Set([
      env.AMCORE_QUEUE_ACCESS_KEY || '',
      env.BUILD_QUEUE_ACCESS_KEY || '',
      ...tenants.map((tenant) => tenant?.queueAccessKey || ''),
    ].filter(Boolean))],
    publicLinkSecretForTenant: (tenant) => tenant?.queueAccessKey || env.BUILD_QUEUE_ACCESS_KEY || env.AMCORE_QUEUE_ACCESS_KEY || '',
  };

  const router = createRouter({ tenants, notionRequest: notion.notionRequest, logger, calendarIdentityResolve: calendarIntegration.resolveIdentity });
  // 網頁管理模組更新群組設定後可立即使路由快取失效；router 本身仍是 core 唯一擁有者。
  platform.router = router;
  const modules = await loadModules({ tenants, platform, logger });
  const dispatcher = createDispatcher({ tenants, modules, platform, logger });

  return { env, logger, tenants, registry, platform, line, notion, drive, portal, llm, operationalMemory, router, modules, dispatcher };
}
