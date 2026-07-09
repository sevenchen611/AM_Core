// AM Platform core — Google Drive 接線(照片原圖等)
// 全域 OAuth 憑證(平台一組);目標資料夾由呼叫端(模組)以 ctx.tenant.driveRootFolderId 決定。
// token/ensureFolder/upload 均抽自 BuildAM src/server.js。

import crypto from 'node:crypto';

export function createDrive({ clientId, clientSecret, refreshToken, logger = console }) {
  const configured = Boolean(clientId && clientSecret && refreshToken);
  let accessToken = { value: '', expiresAt: 0 };
  const folderCache = new Map();

  async function getAccessToken() {
    if (accessToken.value && Date.now() < accessToken.expiresAt) return accessToken.value;
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(`Google token refresh failed: ${response.status} ${JSON.stringify(json)}`);
    accessToken = { value: json.access_token, expiresAt: Date.now() + (Number(json.expires_in || 3600) - 300) * 1000 };
    return accessToken.value;
  }

  async function ensureFolder(name, parentId) {
    const cacheKey = `${parentId}/${name}`;
    if (folderCache.has(cacheKey)) return folderCache.get(cacheKey);
    const token = await getAccessToken();
    const query = `name = '${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const searchResponse = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const search = await searchResponse.json();
    if (!searchResponse.ok) throw new Error(`Drive folder search failed: ${searchResponse.status} ${JSON.stringify(search)}`);
    let folderId = search.files?.[0]?.id;
    if (!folderId) {
      const createResponse = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
      });
      const created = await createResponse.json();
      if (!createResponse.ok) throw new Error(`Drive folder create failed: ${createResponse.status} ${JSON.stringify(created)}`);
      folderId = created.id;
    }
    folderCache.set(cacheKey, folderId);
    return folderId;
  }

  async function upload(buffer, filename, contentType, parentId) {
    const token = await getAccessToken();
    const boundary = `amcore${crypto.randomBytes(12).toString('hex')}`;
    const metadata = JSON.stringify({ name: filename, parents: [parentId] });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
      Buffer.from(buffer),
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    const json = await response.json();
    if (!response.ok) throw new Error(`Drive upload failed: ${response.status} ${JSON.stringify(json)}`);
    return json;
  }

  return { configured, getAccessToken, ensureFolder, upload };
}
