// AM Platform core — 模組載入與分派
// 依租戶 modules 清單載 modules/<name>/index.js;對每則事件建 ctx,依序呼叫 onMessage/onAudio
//   (回傳 true 短路);掛載各模組 routes;提供 tick 排程。
// 模組不綁死租戶:同一份模組實例服務所有租戶,租戶脈絡每次由 ctx.tenant 帶入。

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CORE_DIR = path.dirname(fileURLToPath(import.meta.url));
const MODULES_DIR = path.resolve(CORE_DIR, '..', 'modules');

const AUDIO_EXT = /\.(m4a|mp3|aac|wav|amr|ogg|mp4)$/i;
function isAudioCandidate(message) {
  return message.type === 'audio' || (message.type === 'file' && AUDIO_EXT.test(message.fileName || ''));
}

// 載入所有租戶需要的模組(去重),呼叫其 init(platform)。回傳 name → module 實例。
export async function loadModules({ tenants, platform, logger = console }) {
  const needed = new Set();
  for (const tenant of tenants) for (const name of tenant.modules) needed.add(name);

  const registry = new Map();
  for (const name of needed) {
    const entry = path.join(MODULES_DIR, name, 'index.js');
    if (!fs.existsSync(entry)) {
      logger.warn(`Module "${name}" requested by a tenant but modules/${name}/index.js not found — skipped (will be a no-op until shipped).`);
      continue;
    }
    try {
      const mod = (await import(pathToFileURL(entry).href)).default;
      if (!mod || typeof mod !== 'object') { logger.warn(`Module "${name}" has no default export object — skipped.`); continue; }
      if (typeof mod.init === 'function') mod.init(platform);
      registry.set(name, mod);
      logger.log(`Loaded module: ${name}`);
    } catch (error) {
      logger.warn(`Failed to load module "${name}": ${error.message}`);
    }
  }
  return registry;
}

// 建立分派器。dispatchMessage 消化一則 LINE message event;collectRoutes/runTicks 供 server 與排程用。
export function createDispatcher({ tenants, modules, platform, logger = console }) {
  // 依租戶 modules 清單順序取出「已載入」的模組實例。
  function tenantModules(tenant) {
    return tenant.modules.map((name) => modules.get(name)).filter(Boolean);
  }

  // 為一則事件建立基礎 ctx(不含音檔 buffer)。
  function baseCtx({ tenant, binding, groupId, isMaster, senderName, event, message, text }) {
    return {
      tenant,
      binding,
      groupId,
      isMaster,
      senderName,
      event,
      message,
      text,
      // 便利句柄(選用):tenant-locked notionRequest;模組也可直接用 platform.notionRequest。
      notionRequest: (pathname, opts = {}) => platform.notionRequest(pathname, { ...opts, tenantKey: tenant.key }),
      pushLineMessage: platform.pushLineMessage,
    };
  }

  // 消化一則 message event。tenant/binding 由 server 先解析後帶入(未綁定則不呼叫此函式)。
  async function dispatchMessage({ tenant, binding, event }) {
    const message = event.message;
    const groupId = event.source?.groupId || event.source?.roomId || '';
    const isMaster = binding?.role === '總管';
    const senderName = await platform.resolveSenderName(event.source);
    const text = message.type === 'text' ? String(message.text || '') : '';

    const ctx = baseCtx({ tenant, binding, groupId, isMaster, senderName, event, message, text });

    // 音檔 buffer 延遲下載:只有真的要交給某模組 onAudio 時才下載一次。
    let bufferPromise = null;
    const ensureBuffer = () => {
      if (!bufferPromise) bufferPromise = platform.downloadLineContent(String(message.id || ''));
      return bufferPromise;
    };

    const audio = isAudioCandidate(message);
    for (const mod of tenantModules(tenant)) {
      try {
        const useAudio = audio && typeof mod.onAudio === 'function'
          && (typeof mod.isAudio === 'function' ? mod.isAudio(message) === true : false);
        let handled;
        if (useAudio) {
          let content;
          try {
            content = await ensureBuffer();
          } catch (dlErr) {
            // 音檔內容抓不到(LINE 仍在轉檔且重試耗盡,或下載真失敗):明講並請重傳,
            // 不要靜默丟掉——否則使用者以為已收到,反而把手機原檔刪了。
            logger.warn(`Audio content download failed (tenant=${tenant.key}, group=${groupId}): ${dlErr.message}`);
            await platform.pushLineMessage(groupId, '⚠ 沒收到這則語音的內容(LINE 可能還在處理),請稍候再重傳一次。').catch(() => {});
            break;
          }
          handled = await mod.onAudio({
            ...ctx,
            buffer: content.buffer,
            contentType: content.contentType,
            filename: message.fileName || `audio-${message.id}.m4a`,
            ackSent: false,
          });
        } else if (typeof mod.onMessage === 'function') {
          handled = await mod.onMessage(ctx);
        }
        if (handled === true) break; // 短路後續模組
      } catch (error) {
        logger.warn(`Module "${mod.name}" failed on message (tenant=${tenant.key}, group=${groupId}): ${error.message}`);
      }
    }
  }

  // 蒐集所有租戶 × 已啟用模組的 web routes。每筆帶其租戶,供 web 端點按需切租戶。
  function collectRoutes() {
    const routes = [];
    for (const tenant of tenants) {
      for (const mod of tenantModules(tenant)) {
        for (const route of mod.routes || []) {
          routes.push({ tenantKey: tenant.key, moduleName: mod.name, route });
        }
      }
    }
    return routes;
  }

  // 巡邏排程:對每個租戶、每個有 tick 的模組呼叫一次。錯誤隔離。
  async function runTicks() {
    for (const tenant of tenants) {
      for (const mod of tenantModules(tenant)) {
        if (typeof mod.tick !== 'function') continue;
        try {
          await mod.tick({ tenant, notionRequest: (p, o = {}) => platform.notionRequest(p, { ...o, tenantKey: tenant.key }) });
        } catch (error) {
          logger.warn(`Module "${mod.name}" tick failed (tenant=${tenant.key}): ${error.message}`);
        }
      }
    }
  }

  return { dispatchMessage, collectRoutes, runTicks };
}
