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
const ROUTE_ACCESS_KINDS = new Set(['public', 'machine', 'tenant', 'group']);
function isAudioCandidate(message) {
  return message.type === 'audio' || (message.type === 'file' && AUDIO_EXT.test(message.fileName || ''));
}
// 檔頭 magic bytes 辨識音檔:分享進 LINE 的錄音常掉副檔名,LINE content-type 又常回 octet-stream,
// 光看檔名/類型會漏接;下載後看前幾個 byte 才可靠。
function looksLikeAudioBuffer(arrayBuffer) {
  const b = Buffer.from(arrayBuffer);
  if (b.length < 12) return false;
  const at = (i, n) => b.slice(i, i + n).toString('latin1');
  if (at(4, 4) === 'ftyp') return true;                          // MP4 / M4A(含音訊的 mp4 亦可轉寫)
  if (at(0, 3) === 'ID3') return true;                           // MP3(帶 ID3 標頭)
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return true;      // MP3 / AAC-ADTS frame sync
  if (at(0, 4) === 'RIFF' && at(8, 4) === 'WAVE') return true;   // WAV
  if (at(0, 4) === 'OggS') return true;                          // OGG
  if (at(0, 5) === '#!AMR') return true;                         // AMR
  return false;
}

// 載入所有租戶需要的模組(去重),呼叫其 init(platform)。回傳 name → module 實例。
export async function loadModules({ tenants, platform, logger = console }) {
  const needed = new Set();
  for (const tenant of tenants) {
    if (tenant.runtimeEnabled === false) continue;
    for (const name of tenant.modules) needed.add(name);
  }

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
    if (tenant.runtimeEnabled === false) return [];
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
      principal: { kind: 'system', source: 'line-webhook' },
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

    const nameAudio = isAudioCandidate(message);
    // 檔名沒命中的 file,且此租戶有能吃音檔的模組 → 下載後用檔頭補判(分享進 LINE 常掉副檔名)。
    let contentAudio = false;
    if (!nameAudio && message.type === 'file' && tenantModules(tenant).some((m) => typeof m.onAudio === 'function')) {
      try {
        // 只抓開頭 64 byte 驗檔頭(Range),不必為了辨識就把整個大檔(可能上百 MB)下載進記憶體。
        const head = typeof platform.peekLineContent === 'function'
          ? await platform.peekLineContent(String(message.id || ''), 64)
          : (await ensureBuffer()).buffer;
        contentAudio = looksLikeAudioBuffer(head);
        if (contentAudio) logger.log(`Audio detected by header (tenant=${tenant.key}, file="${message.fileName || ''}").`);
      } catch (e) {
        logger.warn(`Audio header sniff failed (tenant=${tenant.key}, group=${groupId}): ${e.message}`);
      }
    }
    const audio = nameAudio || contentAudio;
    // 讓後續 onMessage 模組(尤其 collect)共用同一份「是否會議音檔」判定,避免各自用副檔名重判:
    // collect 才不會把「掉了副檔名的錄音」當一般附件整包下載+上傳。
    ctx.isMeetingAudio = audio;
    // 下游轉寫/存檔要吃得到副檔名;檔名掉了副檔名(或 type=audio 無檔名)時補一個 .m4a。
    const audioFilename = AUDIO_EXT.test(message.fileName || '') ? message.fileName : `audio-${message.id}.m4a`;
    for (const mod of tenantModules(tenant)) {
      try {
        // 檔頭判定為音檔 → 交給任何有 onAudio 的模組(現況即 meetings);檔名判定 → 由模組自己的 isAudio 決定。
        const useAudio = audio && typeof mod.onAudio === 'function'
          && (contentAudio || (typeof mod.isAudio === 'function' ? mod.isAudio(message) === true : false));
        let handled;
        if (useAudio) {
          // 不在此預先下載整個大檔(可能上百 MB,會撐爆記憶體、也拖慢反問)。
          // 只把 messageId 交給模組:它先發反問,轉寫時才串流下載(邊下載邊上傳 AssemblyAI)。
          // 相容:若平台未提供 streamLineContent,退回舊的整包下載,行為不變。
          const streamable = typeof platform.streamLineContent === 'function';
          let legacyContent = null;
          if (!streamable) {
            try { legacyContent = await ensureBuffer(); }
            catch (dlErr) {
              logger.warn(`Audio content download failed (tenant=${tenant.key}, group=${groupId}): ${dlErr.message}`);
              await platform.pushLineMessage(groupId, '⚠ 沒收到這則語音的內容(LINE 可能還在處理),請稍候再重傳一次。').catch(() => {});
              break;
            }
          }
          handled = await mod.onAudio({
            ...ctx,
            audioMessageId: String(message.id || ''),
            buffer: legacyContent ? legacyContent.buffer : undefined,
            contentType: legacyContent ? legacyContent.contentType : undefined,
            filename: audioFilename,
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
          if (!route?.access || !ROUTE_ACCESS_KINDS.has(route.access.kind)) {
            logger.warn(`Module "${mod.name}" route "${route?.prefix || '(custom)'}" has no valid access declaration — skipped (fail closed).`);
            continue;
          }
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
          await mod.tick({
            tenant,
            principal: { kind: 'system', source: 'scheduler' },
            notionRequest: (p, o = {}) => platform.notionRequest(p, { ...o, tenantKey: tenant.key }),
          });
        } catch (error) {
          logger.warn(`Module "${mod.name}" tick failed (tenant=${tenant.key}): ${error.message}`);
        }
      }
    }
  }

  return { dispatchMessage, collectRoutes, runTicks };
}
