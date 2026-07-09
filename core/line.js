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

  async function downloadLineContent(messageId) {
    if (!channelAccessToken) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not set.');
    const response = await fetch(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`, {
      headers: { Authorization: `Bearer ${channelAccessToken}` },
    });
    if (!response.ok) throw new Error(`LINE content download failed: ${response.status} ${await response.text()}`);
    return { buffer: await response.arrayBuffer(), contentType: response.headers.get('content-type') || 'application/octet-stream' };
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
    resolveLineFilename,
    pushLineMessage,
    configured: Boolean(channelAccessToken && channelSecret),
  };
}
