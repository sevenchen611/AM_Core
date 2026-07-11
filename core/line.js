// AM Platform core — LINE 接線(共用同一支 OA)
// 簽章驗證 / 取成員名 / 下載內容 / 推播,均抽自 BuildAM src/server.js,功能不變。
// 平台一支 OA:全域 LINE_CHANNEL_* 憑證;webhook 為唯一入口。

import crypto from 'node:crypto';

export function createLine({ channelAccessToken, channelSecret, logger = console }) {
  // LINE webhook 簽章驗證(HMAC-SHA256, timing-safe)。
  function isValidSignature(rawBody, signature) {
    if (!channelSecret || !signature) return false;
    const expected = crypto.createHmac('sha256', channelSecret).update(rawBody).digest('base64');
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)));
    } catch {
      return false;
    }
  }

  async function lineGet(pathname) {
    if (!channelAccessToken) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not set.');
    const response = await fetch(`https://api.line.me${pathname}`, {
      headers: { Authorization: `Bearer ${channelAccessToken}` },
    });
    if (!response.ok) throw new Error(`LINE API failed: ${response.status} ${await response.text()}`);
    return response.json();
  }

  // 顯示名稱:群/房/1對1 分別取,失敗退回預設(不阻斷訊息流程)。
  async function resolveSenderName(source) {
    const fallback = 'LINE 使用者';
    if (!source?.userId || !channelAccessToken) return fallback;
    try {
      if (source.groupId) {
        const p = await lineGet(`/v2/bot/group/${encodeURIComponent(source.groupId)}/member/${encodeURIComponent(source.userId)}`);
        return p.displayName || fallback;
      }
      if (source.roomId) {
        const p = await lineGet(`/v2/bot/room/${encodeURIComponent(source.roomId)}/member/${encodeURIComponent(source.userId)}`);
        return p.displayName || fallback;
      }
      const p = await lineGet(`/v2/bot/profile/${encodeURIComponent(source.userId)}`);
      return p.displayName || fallback;
    } catch {
      return fallback;
    }
  }

  // 下載音檔/影片內容。LINE 對媒體訊息若後端仍在轉檔,會回 202 或 2xx 空 body,
  // 此時 response.ok 仍為 true —— 舊版直接回傳空 buffer,害下游(AssemblyAI upload 422、
  // Gemini upload 400「No file found」)全部拿到空檔而失敗。故對「未就緒(202 或空 body)」
  // 退避重試,仍為空才誠實丟錯(讓上層能通知使用者重傳,而非靜靜產出空白)。
  async function downloadLineContent(messageId, { tries = 6, baseDelay = 2500 } = {}) {
    if (!channelAccessToken) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not set.');
    const url = `https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`;
    let lastReason = '';
    for (let attempt = 1; attempt <= tries; attempt += 1) {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${channelAccessToken}` } });
      // 202 = 內容仍在準備;其它非 2xx 才是真失敗,直接丟錯。
      if (response.status !== 202 && !response.ok) {
        throw new Error(`LINE content download failed: ${response.status} ${await response.text()}`);
      }
      const buffer = response.status === 202 ? new ArrayBuffer(0) : await response.arrayBuffer();
      if (buffer.byteLength > 0) {
        return { buffer, contentType: response.headers.get('content-type') || 'application/octet-stream' };
      }
      lastReason = response.status === 202 ? '202 轉檔中' : '2xx 空 body';
      if (attempt < tries) await new Promise((r) => setTimeout(r, Math.min(baseDelay * attempt, 15000)));
    }
    throw new Error(`LINE 音檔內容尚未就緒(${lastReason};試 ${tries} 次仍為空),請稍候重傳。`);
  }

  // 只抓開頭若干 byte(HTTP Range)以辨識檔頭,不必為了看 12 個 byte 下載整個大檔。
  // LINE content API 支援 Range(回 206)。202=仍在轉檔,重試幾次;真失敗回空 ArrayBuffer,交呼叫端走退路。
  async function peekLineContent(messageId, bytes = 64, { tries = 4, baseDelay = 2000 } = {}) {
    if (!channelAccessToken) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not set.');
    const url = `https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`;
    for (let attempt = 1; attempt <= tries; attempt += 1) {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${channelAccessToken}`, Range: `bytes=0-${Math.max(0, bytes - 1)}` } });
      if (response.status === 206) return response.arrayBuffer();
      if (response.status === 202) { // 仍在轉檔,稍候再試
        try { await response.body?.cancel?.(); } catch { /* ignore */ }
        if (attempt < tries) { await new Promise((r) => setTimeout(r, Math.min(baseDelay * attempt, 12000))); continue; }
        return new ArrayBuffer(0);
      }
      // Range 未被接受(理論上不會)或其它非 2xx:別誤抓整包大檔,取消並回空。
      try { await response.body?.cancel?.(); } catch { /* ignore */ }
      return new ArrayBuffer(0);
    }
    return new ArrayBuffer(0);
  }

  function resolveLineFilename(message, messageType, messageId, contentType) {
    if (message.fileName) return message.fileName;
    const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif' }[String(contentType).split(';')[0]] || '';
    return `${messageType}-${messageId}${ext}`;
  }

  // 推播(共用 OA);訊息含被點名者名字且已知 userId 時升級為 textV2 真 @mention。
  async function pushLineMessage(to, text, mention) {
    let message = { type: 'text', text: String(text).slice(0, 4900) };
    if (mention?.name && mention?.userId && String(text).includes(mention.name)) {
      message = {
        type: 'textV2',
        text: String(text).replace(mention.name, '{who}').slice(0, 4900),
        substitution: { who: { type: 'mention', mentionee: { type: 'user', userId: mention.userId } } },
      };
    }
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { Authorization: `Bearer ${channelAccessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, messages: [message] }),
    });
    if (!response.ok) throw new Error(`LINE push failed: ${response.status} ${await response.text()}`);
  }

  return {
    isValidSignature,
    lineGet,
    resolveSenderName,
    downloadLineContent,
    peekLineContent,
    resolveLineFilename,
    pushLineMessage,
    configured: Boolean(channelAccessToken && channelSecret),
  };
}
