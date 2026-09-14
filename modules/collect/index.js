// AM Platform 模組:collect(訊息落庫)
// ─────────────────────────────────────────────────────────────────────────
// 由 BuildAM src/server.js 的「訊息落庫」段(handleEvent + storeAttachment)整段抽出,重塑成模組:
//   1. 群組脈絡:用 ctx.binding(路由器已解析)決定群組綁定 / 專案 / 是否總管群。
//   2. 發送者解析:用 ctx.senderName(dispatcher 已用 platform.resolveSenderName 解過)。
//   3. 成員對照:名字 → LINE userId,新對照即時寫回綁定頁(供日後推播真 @mention);已記過零成本。
//   4. 訊息寫入該租戶「訊息」庫(ctx.tenant.dataSources.messages)。
//   5. 照片/檔案 → Notion 附件預覽;照片另存 Drive「未歸檔/日期」。會議錄音不進附件流程(meetings 自存)。
//
// 多租戶契約(modules/README.md):
//   - init(platform):注入共用能力(所有租戶相同):notionRequest / uploadFileToNotion / drive 助手 / LINE 助手。
//   - 每次呼叫由 ctx.tenant 帶「租戶特定設定」:自己的 Notion 資料源(messages/attachments)、Drive 根資料夾。
//   - 模組狀態(成員對照同步紀錄)一律以「(租戶, 群組)」為鍵,不同租戶不互相污染。
//
// 邊界:collect 只負責「落庫」。AI 初判 / 系統回聲自動歸檔 / 確認佇列一律不做(那是 triage / queue)。
//   寫回傳 false → 不短路,讓後續模組(meetings 收音檔、triage 判斷…)接續處理同一則事件。

import { textItem } from '../../core/util.js';

let platform = null;
function init(injected) { platform = injected; }

// ── 純工具 ────────────────────────────────────────────────
// LINE 訊息類型對應 Notion select；影片/音訊也保留真實類型便於稽核。
function mapMessageType(type) {
  return { text: '文字', image: '照片', file: '檔案', video: '影片', audio: '音訊', sticker: '貼圖' }[type] || '其他';
}
function storedMessageContent(message = {}) {
  if (message.type === 'text') return String(message.text || '');
  if (message.type === 'sticker') {
    return `[sticker] package:${String(message.packageId || '')} sticker:${String(message.stickerId || '')}`;
  }
  return '';
}

// 會議錄音判定(與 meetings.isAudio 同準則):音檔訊息或音檔副檔名的檔案。
// collect 據此把「會議錄音」排除在附件流程外——大音檔由 meetings 自己存 Drive,避免重複下載+上傳。
const AUDIO_EXT = /\.(m4a|mp3|aac|wav|amr|ogg|opus|flac)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|avi|mkv|webm|3gp|3g2|wmv|flv)$/i;
const NOTION_DIRECT_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
const NOTION_UPLOAD_EXT = /\.(aac|adts|mid|midi|mp3|mpga|m4a|m4b|mp4|oga|ogg|opus|wav|wma|weba|flac|pdf|txt|csv|json|js|ts|tsx|py|doc|dot|docx|dotx|xls|xlt|xla|xlsx|xltx|ppt|pot|pps|ppa|pptx|potx|rtf|md|markdown|html|htm|epub|xml|css|odt|ods|odp|ics|yaml|yml|tsv|zip|gz|gzip|tar|7z|bz2|rar|gif|heic|jpeg|jpg|png|svg|tif|tiff|webp|ico|bmp|avif|apng|amv|asf|wmv|avi|f4v|flv|gifv|m4v|mkv|webm|mov|qt|mpeg|ogv|3gp|3g2)$/i;
function isMeetingAudio(message) {
  if (message.type === 'audio') return true;
  const filename = message.fileName || '';
  return message.type === 'file' && !VIDEO_EXT.test(filename) && AUDIO_EXT.test(filename);
}

function archiveAllGroupAttachments(tenant, groupId) {
  return Boolean(groupId && tenant?.config?.attachments?.archiveAllLineGroupAttachmentsToDrive === true);
}

function notionUploadCandidate(filename, fileSize = 0) {
  const size = Number(fileSize) || 0;
  return NOTION_UPLOAD_EXT.test(String(filename || ''))
    && (!size || size <= NOTION_DIRECT_UPLOAD_MAX_BYTES);
}

function fallbackFilename(message, messageType, messageId) {
  if (message?.fileName) return message.fileName;
  if (message?.type === 'video') return `video-${messageId}.mp4`;
  if (message?.type === 'audio') return `audio-${messageId}.m4a`;
  return `${messageType}-${messageId}`;
}

// ── 成員對照同步狀態(記憶體,鍵=（租戶,群組）)──────────────
// 已同步過的 name→userId,避免每則訊息都 PATCH 綁定頁。跨租戶不共用。
const memberSync = new Map();
const pkey = (tenant, groupId) => `${(tenant && tenant.key) || 'default'}::${groupId}`;

// 成員對照:記住 顯示名稱→LINE userId(供推播真 @mention 點名)。
// 新對照才寫回綁定頁;binding.members 同步就地更新,讓同一則事件的後續模組立即看得到。
function syncMemberMap(ctx) {
  const { tenant, binding, groupId, senderName, event } = ctx;
  const userId = event?.source?.userId;
  if (!binding || !userId || !senderName) return;
  const key = pkey(tenant, groupId);
  let synced = memberSync.get(key);
  if (!synced) { synced = new Map(); memberSync.set(key, synced); }

  // 已記過(本模組記憶體 或 綁定頁本身已含)→ 就地補上即可,零成本
  if (synced.get(senderName) === userId || binding.members?.[senderName] === userId) {
    if (binding.members) binding.members[senderName] = userId;
    synced.set(senderName, userId);
    return;
  }
  if (binding.members) binding.members[senderName] = userId;
  synced.set(senderName, userId);

  // 寫回綁定頁(fire-and-forget:不擋訊息落庫;與 BuildAM 一致)
  const notionRequest = ctx.notionRequest || platform.notionRequest;
  notionRequest(`/v1/pages/${encodeURIComponent(binding.pageId)}`, {
    method: 'PATCH',
    body: { properties: { '成員對照': { rich_text: [textItem(JSON.stringify(binding.members || {}).slice(0, 1900))] } } },
  }).catch((error) => console.warn(`member map update failed: ${error.message}`));
}

// ── 落庫主流程 ────────────────────────────────────────────
// 每則訊息:寫入該租戶「訊息」庫 → (照片/檔案)存附件。寫完回傳 false 讓後續模組續跑。
async function onMessage(ctx) {
  const { tenant, binding, groupId, isMaster, senderName, event, message } = ctx;
  const messagesDs = tenant?.dataSources?.messages;
  if (!messagesDs) return false; // 此租戶未設定訊息庫 → 無法落庫,交棒後續模組

  const notionRequest = ctx.notionRequest || platform.notionRequest;
  const messageId = String(message.id || '');
  const eventTime = new Date(event?.timestamp || Date.now()).toISOString();
  const messageType = mapMessageType(message.type);
  const text = storedMessageContent(message);

  // 成員對照:名字→userId(新對照寫回綁定頁);已記過零成本
  syncMemberMap(ctx);

  const titleText = text ? text.slice(0, 60) : `[${messageType}] ${senderName}`;
  const properties = {
    '訊息': { title: [textItem(titleText)] },
    '內容': { rich_text: text ? [textItem(text.slice(0, 1900))] : [] },
    'LINE 群組 ID': { rich_text: groupId ? [textItem(groupId)] : [] },
    'LINE 訊息 ID': { rich_text: messageId ? [textItem(messageId)] : [] },
    '發送者': { rich_text: [textItem(senderName)] },
    '時間': { date: { start: eventTime } },
    '訊息類型': { select: { name: messageType } },
    '掛載狀態': { select: { name: '未掛載' } },
  };
  if (binding) {
    if (binding.pageId) properties['群組綁定'] = { relation: [{ id: binding.pageId }] };
    // 總管群跨專案:訊息先不掛專案,留待佇列人工選「哪個專案」(與 BuildAM 一致)
    if (binding.projectPageId && !isMaster) {
      properties['專案'] = { relation: [{ id: binding.projectPageId }] };
    }
  }

  const messagePage = await notionRequest('/v1/pages', {
    method: 'POST',
    body: { parent: { type: 'data_source_id', data_source_id: messagesDs }, properties },
  });
  // 交棒點:把落好的訊息列 id 掛回 ctx,後續模組(triage/queue)承接同一列,免得再查一次
  ctx.messagePageId = messagePage.id;

  // 照片/檔案/影片 → 附件庫。開啟租戶政策時，LINE 群組附件一律原檔存 Drive。
  // 會議錄音仍由 meetings 以串流存入 Drive「會議錄音/日期」，避免重複留存。
  // 用 dispatch 已算好的「是否音檔」(含檔頭補判),避免掉了副檔名的錄音被當附件整包下載+上傳。
  const attachmentsDs = tenant?.dataSources?.attachments;
  const isAudioMsg = ctx.isMeetingAudio ?? isMeetingAudio(message);
  if (['image', 'file', 'video'].includes(message.type) && attachmentsDs && !isAudioMsg) {
    try {
      const stored = await storeAttachment({ ctx, messagePage, messageId, messageType, eventTime });
      // 交棒給 media:附件頁 id + 圖片 buffer(供視覺判讀)掛回 ctx
      if (stored?.attachmentPage?.id) ctx.attachmentPageId = stored.attachmentPage.id;
      if (stored?.content && message.type === 'image') {
        ctx.media = { buffer: stored.content.buffer, contentType: stored.content.contentType };
      }
    } catch (error) {
      console.warn(`Store attachment failed for ${messageId}: ${error.message}`);
    }
  }

  console.log(`[collect] tenant=${tenant.key} stored ${messageType} ${messageId} (group=${groupId || 'direct'}, project=${binding?.projectPageId && !isMaster ? 'bound' : 'unbound'}).`);
  return false; // 不短路,讓後續模組續跑
}

// 照片/檔案/影片落地：Google Drive 是工程租戶的原檔真實來源；
// Notion 僅在格式受支援且不超過 direct-upload 上限時加上預覽檔。
async function storeAttachment({ ctx, messagePage, messageId, messageType, eventTime }) {
  const { tenant, binding, message, event, senderName, groupId } = ctx;
  const notionRequest = ctx.notionRequest || platform.notionRequest;
  const archiveAll = archiveAllGroupAttachments(tenant, groupId);
  const initialFilename = fallbackFilename(message, messageType, messageId);
  const initialSize = Number(message.fileSize) || 0;
  const shouldStreamFirst = archiveAll
    && ['file', 'video'].includes(message.type)
    && (!notionUploadCandidate(initialFilename, initialSize) || message.type === 'video');

  let content = null;
  let driveFile = null;
  let archivedContentType = '';
  let archivedContentLength = 0;

  const taipeiDate = new Date((event?.timestamp || Date.now()) + 8 * 3600 * 1000).toISOString().slice(0, 10);
  let dayFolderId = '';
  const ensureDayFolder = async () => {
    if (dayFolderId) return dayFolderId;
    const unfiledFolderId = await platform.ensureDriveFolder('未歸檔', tenant.driveRootFolderId);
    dayFolderId = await platform.ensureDriveFolder(taipeiDate, unfiledFolderId);
    return dayFolderId;
  };

  if (shouldStreamFirst && tenant?.driveConfigured
    && typeof platform.streamLineContent === 'function'
    && typeof platform.uploadDriveStream === 'function') {
    try {
      const streamed = await platform.streamLineContent(messageId);
      archivedContentType = streamed.contentType || 'application/octet-stream';
      archivedContentLength = Number(streamed.contentLength) || initialSize;
      if (!archivedContentLength) {
        try { await streamed.stream?.cancel?.(); } catch { /* ignore */ }
        throw new Error('LINE 未回 content-length，無法串流留存');
      }
      driveFile = await platform.uploadDriveStream(
        streamed.stream,
        initialFilename,
        archivedContentType,
        await ensureDayFolder(),
        archivedContentLength,
      );
    } catch (error) {
      console.warn(`Unable to stream LINE attachment ${messageId} to Google Drive: ${error.message}`);
    }
  }

  if (!shouldStreamFirst || !driveFile) {
    try {
      content = await platform.downloadLineContent(messageId);
    } catch (error) {
      console.warn(`Unable to download LINE content ${messageId}: ${error.message}`);
    }
  }
  const filename = content
    ? platform.resolveLineFilename(message, messageType, messageId, content.contentType)
    : initialFilename;

  let uploaded = null;
  if (content && notionUploadCandidate(filename, content.buffer.byteLength || initialSize)) {
    try {
      const upload = await platform.uploadFileToNotion(content.buffer, filename, content.contentType);
      uploaded = { fileUploadId: upload.id, contentLength: content.buffer.byteLength };
    } catch (error) {
      console.warn(`Unable to upload LINE content ${messageId} to Notion: ${error.message}`);
    }
  }

  // 舊預設只存照片；租戶開啟強制政策後，所有群組附件原檔都存 Drive。
  if (!driveFile && content && tenant?.driveConfigured && (message.type === 'image' || archiveAll)) {
    try {
      driveFile = await platform.uploadToDrive(content.buffer, filename, content.contentType, await ensureDayFolder());
      archivedContentType = content.contentType;
      archivedContentLength = content.buffer.byteLength;
    } catch (error) {
      console.warn(`Unable to upload LINE attachment ${messageId} to Google Drive: ${error.message}`);
    }
  }

  const properties = {
    '附件項目': { title: [textItem(filename)] },
    '訊息': { relation: [{ id: messagePage.id }] },
    '日期': { date: { start: eventTime } },
    '檔案名稱': { rich_text: [textItem(filename)] },
    '檔案大小': { number: Number(message.fileSize || archivedContentLength || uploaded?.contentLength || 0) || null },
  };
  if (binding?.projectPageId) {
    properties['專案'] = { relation: [{ id: binding.projectPageId }] };
  }
  if (uploaded?.fileUploadId) {
    properties['檔案'] = { files: [{ type: 'file_upload', file_upload: { id: uploaded.fileUploadId }, name: filename }] };
  }
  if (driveFile?.webViewLink) {
    properties['Drive 連結'] = { url: driveFile.webViewLink };
  }

  const attachmentPage = await notionRequest('/v1/pages', {
    method: 'POST',
    body: { parent: { type: 'data_source_id', data_source_id: tenant.dataSources.attachments }, properties },
  });
  console.log(`[collect] stored attachment ${filename} from ${senderName} (drive=${driveFile?.webViewLink ? 'yes' : 'no'}, notion=${uploaded?.fileUploadId ? 'yes' : 'no'}, contentType=${archivedContentType || content?.contentType || 'unknown'}).`);
  return { attachmentPage, content, driveFile };
}

// ── 模組契約:預設匯出 ─────────────────────────────────────
export default {
  name: 'collect',
  init,
  onMessage,          // (ctx) 每則訊息落庫;寫完回傳 false 讓後續模組續跑
};

// 測試用內部匯出(不影響正式流程)
export const __test = {
  mapMessageType,
  storedMessageContent,
  isMeetingAudio,
  archiveAllGroupAttachments,
  notionUploadCandidate,
  fallbackFilename,
  storeAttachment,
  syncMemberMap,
};
