// AM Platform core — 租戶登記載入
// 讀 tenants/*.json(結構),依 envPrefix 從平台 .env 補進機密(頁 ID / 資料源 ID / Drive 根)。
// 租戶是「資料」;此處把資料 + 機密組成執行期 tenant 物件,供路由器與模組使用。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeId, camelFromEnv } from './util.js';

const CORE_DIR = path.dirname(fileURLToPath(import.meta.url));
const TENANTS_DIR = path.resolve(CORE_DIR, '..', 'tenants');

// 平台級 Google Drive 憑證是否齊備(Drive 根資料夾則 per-tenant)。
function driveGlobalConfigured(env) {
  return Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REFRESH_TOKEN);
}

// (如有)per-tenant LINE 覆寫;平台預設共用同一支 OA(全域 LINE_* 憑證)。
function readLineOverride(env, prefix) {
  const accessToken = env[`${prefix}_LINE_CHANNEL_ACCESS_TOKEN`] || '';
  const secret = env[`${prefix}_LINE_CHANNEL_SECRET`] || '';
  if (!accessToken && !secret) return null;
  return { accessToken, secret };
}

function prefixed(env, prefix, name, fallback = '') {
  return env[`${prefix}_${name}`] || fallback || '';
}

function readCalendars(env, prefix) {
  const calendars = {};
  const re = new RegExp(`^${prefix}_CAL_(.+)$`);
  for (const [key, value] of Object.entries(env)) {
    const match = key.match(re);
    if (match && value) calendars[match[1].toUpperCase()] = value;
  }
  return calendars;
}

// AI 可由租戶覆寫；沒有 <PREFIX>_* 時才回退平台共用金鑰。
// 機密只存在執行期 tenant 物件，不會寫回 tenants/*.json 或 /health。
function readAi(env, prefix) {
  return {
    provider: prefixed(env, prefix, 'AI_PROVIDER', env.AMCORE_AI_PROVIDER).toLowerCase(),
    judgeModel: prefixed(env, prefix, 'AI_JUDGE_MODEL', env.AMCORE_AI_JUDGE_MODEL),
    meetingModel: prefixed(env, prefix, 'MEETING_MODEL', env.AMCORE_MEETING_MODEL || 'gemini-2.5-flash'),
    anthropicApiKey: prefixed(env, prefix, 'ANTHROPIC_API_KEY', env.ANTHROPIC_API_KEY),
    assemblyKey: prefixed(env, prefix, 'ASSEMBLYAI_API_KEY', env.ASSEMBLYAI_API_KEY),
    geminiKey: prefixed(env, prefix, 'GEMINI_API_KEY', env.GEMINI_API_KEY),
    minimaxApiKey: prefixed(env, prefix, 'MINIMAX_API_KEY', env.MINIMAX_API_KEY),
    minimaxBaseUrl: prefixed(env, prefix, 'MINIMAX_API_BASE_URL', env.MINIMAX_API_BASE_URL || 'https://api.minimax.io/v1').replace(/\/+$/, ''),
  };
}

function readConfig(rawConfig, env, prefix) {
  const config = (rawConfig && typeof rawConfig === 'object')
    ? JSON.parse(JSON.stringify(rawConfig))
    : {};
  const meetingsLiffId = prefixed(env, prefix, 'MEETINGS_LIFF_ID', env.AMCORE_MEETINGS_LIFF_ID).trim();
  if (meetingsLiffId) {
    config.meetings = { ...(config.meetings || {}), liffId: meetingsLiffId };
  }
  return config;
}

// 讀所有 tenants/*.json(略過 _ 開頭與 README),組成執行期 tenant 陣列。
export function loadTenants(env = process.env, logger = console) {
  const files = fs.readdirSync(TENANTS_DIR)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .sort();

  const tenants = [];
  for (const file of files) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(TENANTS_DIR, file), 'utf8'));
    } catch (error) {
      logger.warn(`Tenant ${file} is not valid JSON, skipped: ${error.message}`);
      continue;
    }
    if (!raw.key || !raw.envPrefix) {
      logger.warn(`Tenant ${file} missing key/envPrefix, skipped.`);
      continue;
    }

    const prefix = raw.envPrefix;
    const parentPageId = normalizeId(env[`${prefix}_NOTION_PARENT_PAGE_ID`] || '');
    // 會議可選擇依群組分庫。未指定專用母頁時，使用租戶母頁，
    // 讓所有租戶預設遵守「每個群組一個會議庫」的隔離規則。
    const meetingsParentPageId = normalizeId(env[`${prefix}_MEETINGS_PARENT_PAGE_ID`] || parentPageId);

    // 掃描 <PREFIX>_<NAME>_DATA_SOURCE_ID → dataSources[name]。每個租戶宣告自己有哪些庫。
    const dataSources = {};
    const dsRe = new RegExp(`^${prefix}_(.+)_DATA_SOURCE_ID$`);
    for (const [k, v] of Object.entries(env)) {
      const m = k.match(dsRe);
      if (m && v) dataSources[camelFromEnv(m[1])] = v;
    }

    const driveRootFolderId = env[`${prefix}_DRIVE_ROOT_FOLDER_ID`] || '';
    const queueAccessKey = prefixed(env, prefix, 'QUEUE_ACCESS_KEY', env.AMCORE_QUEUE_ACCESS_KEY);
    const portalPin = prefixed(env, prefix, 'PORTAL_PIN', env.AMCORE_PORTAL_PIN);
    const line = readLineOverride(env, prefix);
    if (line && (line.accessToken !== (env.LINE_CHANNEL_ACCESS_TOKEN || '') || line.secret !== (env.LINE_CHANNEL_SECRET || ''))) {
      logger.warn(`Tenant ${raw.key} has a ${prefix}_LINE_* override that differs from the shared OA; AM Platform ignores tenant LINE overrides and uses global LINE_* only.`);
    }
    const tenant = {
      key: raw.key,
      displayName: raw.displayName || raw.key,
      tenantId: raw.tenantId || '',
      envPrefix: prefix,
      // 遷移中租戶可先出現在 Portal 目錄，但不得參與 webhook、模組路由或排程。
      runtimeEnabled: raw.runtimeEnabled !== false,
      authorizationReady: raw.authorizationReady !== false,
      modules: Array.isArray(raw.modules) ? raw.modules : [],
      // 「行業味」設定:詞彙、報告時刻表、欄位映射…等非機密的租戶特性。
      // 模組一律從 ctx.tenant.config 讀,不可硬寫進程式(見 modules/HOZO_EXTRACTION_PLAN.md §0)。
      // 機密(頁 ID/資料源 ID/金鑰)不放這裡——那些走 .env 的 <PREFIX>_*。
      config: readConfig(raw.config, env, prefix),
      operationalMemory: raw.operationalMemory && typeof raw.operationalMemory === 'object'
        ? JSON.parse(JSON.stringify(raw.operationalMemory))
        : null,
      // ── 機密(來自平台 .env,不進 git)──
      parentPageId,                 // 資料隔離母頁:此租戶所有庫必須位於其下
      meetingsParentPageId,         // 每群獨立會議庫的建立母頁；預設為租戶母頁
      dataSources,                  // { messages, groupBindings, meetings, tasks, projects, ... }
      driveRootFolderId,
      driveConfigured: Boolean(driveRootFolderId && driveGlobalConfigured(env)),
      queueAccessKey,
      portalPin,
      publicBaseUrl: prefixed(env, prefix, 'PUBLIC_BASE_URL', env.AMCORE_PUBLIC_BASE_URL).trim().replace(/\/+$/, ''),
      calendars: readCalendars(env, prefix),
      reminders: {
        escalationDays: Number(prefixed(env, prefix, 'ESCALATION_DAYS', env.AMCORE_ESCALATION_DAYS) || 2),
        reminderHour: Number(prefixed(env, prefix, 'REMINDER_HOUR', env.AMCORE_REMINDER_HOUR) || 9),
        escalationOwner: prefixed(env, prefix, 'ESCALATION_OWNER', env.AMCORE_ESCALATION_OWNER || '租戶管理者'),
      },
      ai: readAi(env, prefix),
      line,                          // 只供設定盤點；正式收送仍由平台全域同一支 OA 負責
      // Notion 是否可用(至少要有母頁 + 訊息庫 + 群組綁定庫才能路由與落庫)
      notionConfigured: Boolean(parentPageId && dataSources.messages && dataSources.groupBindings),
    };
    tenants.push(tenant);
  }
  return tenants;
}

// 資料隔離登記:normalizeId(資料源 ID) → 擁有它的租戶。跨租戶重複宣告視為設定錯誤(拒絕)。
export function buildDataSourceRegistry(tenants, logger = console) {
  const registry = new Map();
  for (const tenant of tenants) {
    for (const [name, id] of Object.entries(tenant.dataSources)) {
      if (!id) continue;
      const norm = normalizeId(id);
      const existing = registry.get(norm);
      if (existing && existing.tenant.key !== tenant.key) {
        logger.warn(`Data source ${id} declared by both ${existing.tenant.key} and ${tenant.key}; keeping ${existing.tenant.key}.`);
        continue;
      }
      registry.set(norm, { tenant, name });
    }
  }
  return registry;
}
