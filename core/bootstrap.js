// AM Platform core — 組裝
// 從 env 建立:租戶登記 + 資料源隔離登記 + 共用能力(notion/line/drive/portal)+ 路由器 + 分派器。
// server.js 用真憑證呼叫;dryrun 測試харness 可用 overrides 注入 mock(不打真 API)。

import { loadTenants, buildDataSourceRegistry } from './tenants.js';
import { createNotion } from './notion.js';
import { createLine } from './line.js';
import { createDrive } from './drive.js';
import { createPortal } from './portal.js';
import { createLlm } from './llm.js';
import { createRouter } from './router.js';
import { loadModules, createDispatcher } from './modules.js';

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
    queueAccessKey: env.AMCORE_QUEUE_ACCESS_KEY || env.BUILD_QUEUE_ACCESS_KEY || '',
    portalPin: env.AMCORE_PORTAL_PIN || '',
    logger,
  });
  // LLM 抽象層:可插拔後端 + 統一備援鏈(鏈序見 AMCORE_LLM_CHAIN)。
  const llm = overrides.llm || createLlm({ env, logger });

  // 注入模組 init(platform) 的共用能力包(比照 BuildAM 各 init 的聯集,平台級一份)。
  const platform = {
    logger,
    // Notion(per-tenant 隔離守衛內建)
    notionRequest: notion.notionRequest,
    uploadFileToNotion: notion.uploadFileToNotion,
    // LINE(共用 OA)
    pushLineMessage: line.pushLineMessage,
    lineGet: line.lineGet,
    downloadLineContent: line.downloadLineContent,
    resolveSenderName: line.resolveSenderName,
    resolveLineFilename: line.resolveLineFilename,
    // Drive(全域憑證,目標資料夾由租戶決定)
    drive,
    driveConfigured: drive.configured,
    ensureDriveFolder: drive.ensureFolder,
    uploadToDrive: drive.upload,
    getDriveAccessToken: drive.getAccessToken,
    // Portal 授權(web routes 用)
    portal,
    // LLM(統一備援鏈)。新模組一律用這個,不要自己接 AI 供應商。
    llm,
    // AI 金鑰(共用;meetings 等模組於 init 取用)
    // ⚠️ 逐步退場:新程式請改用 platform.llm,金鑰只留給尚未遷移的模組與非 LLM 服務(AssemblyAI)。
    anthropicApiKey: env.ANTHROPIC_API_KEY || '',
    assemblyKey: env.ASSEMBLYAI_API_KEY || '',
    geminiKey: env.GEMINI_API_KEY || '',
    geminiModel: env.BUILD_MEETING_MODEL || env.AMCORE_MEETING_MODEL || 'gemini-2.5-flash',
    minimaxApiKey: env.MINIMAX_API_KEY || '',
    minimaxBaseUrl: (env.MINIMAX_API_BASE_URL || 'https://api.minimax.io/v1').replace(/\/+$/, ''),
    aiProvider: (env.AMCORE_AI_PROVIDER || env.BUILD_AI_PROVIDER || '').toLowerCase(),
    aiJudgeModel: env.AMCORE_AI_JUDGE_MODEL || env.BUILD_AI_JUDGE_MODEL || '',
  };

  const router = createRouter({ tenants, notionRequest: notion.notionRequest, logger });
  const modules = await loadModules({ tenants, platform, logger });
  const dispatcher = createDispatcher({ tenants, modules, platform, logger });

  return { env, logger, tenants, registry, platform, line, notion, drive, portal, llm, router, modules, dispatcher };
}
