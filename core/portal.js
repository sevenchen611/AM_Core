// AM Platform core — Portal 授權(給 web routes 用)
// 兩種登入,抽自 BuildAM src/server.js:
//   1. PIN 通行碼 → 種長效 cookie(平台級)。
//   2. AM Portal 單一登入:驗 rental.hozorental.com 簽發的 hozo_session → /api/me(快取 5 分鐘)。
// core 只負責「驗身分、回傳 user」;哪個租戶/哪些功能可見,交由各 web 模組依 user 授權判斷。

import crypto from 'node:crypto';

export function createPortal({ queueAccessKey, portalPin, meEndpoint = 'https://rental.hozorental.com/api/me', logger = console }) {
  const meCache = new Map();

  function pinCookieValue() {
    return crypto.createHmac('sha256', queueAccessKey || '').update('portal-v1').digest('hex');
  }
  function pinAuthed(req) {
    return Boolean(queueAccessKey) && String(req.headers.cookie || '').includes(`amcore_auth=${pinCookieValue()}`);
  }
  function checkPin(pin) {
    return Boolean(portalPin) && pin === portalPin;
  }

  // 驗 hozo_session → 回傳 user 物件(未登入/無效回 null)。授權規則交給呼叫端。
  async function userAuthed(req) {
    const match = String(req.headers.cookie || '').match(/hozo_session=([^;]+)/);
    if (!match) return null;
    const sessionKey = match[1];
    const cached = meCache.get(sessionKey);
    if (cached && Date.now() < cached.exp) return cached.user;
    try {
      const response = await fetch(meEndpoint, { headers: { cookie: `hozo_session=${sessionKey}` } });
      if (!response.ok) return null;
      const user = (await response.json()).user;
      if (!user || user.active === false) return null;
      meCache.set(sessionKey, { user, exp: Date.now() + 5 * 60 * 1000 });
      return user;
    } catch {
      return null;
    }
  }

  return { pinCookieValue, pinAuthed, checkPin, userAuthed };
}
