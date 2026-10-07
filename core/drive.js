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
      signal: AbortSignal.timeout(30000),
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
    const query = `name = '${quote(name)}' and '${quote(parentId)}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const searchResponse = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30000),
    });
    const search = await searchResponse.json();
    if (!searchResponse.ok) throw new Error(`Drive folder search failed: ${searchResponse.status} ${JSON.stringify(search)}`);
    let folderId = search.files?.[0]?.id;
    if (!folderId) {
      const createResponse = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
        method: 'POST',
        signal: AbortSignal.timeout(30000),
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

  // 串流上傳(resumable):把來源 ReadableStream 直接灌進 Drive,整個大檔不進記憶體。
  // size(bytes)必填才走串流單發 PUT(Google 要 Content-Length);LINE 下載回應都帶 content-length。
  async function uploadStream(stream, filename, contentType, parentId, size, metadata = {}) {
    if (!Number.isFinite(size) || size <= 0) throw new Error('uploadStream needs a known size (bytes)');
    const token = await getAccessToken();
    const init = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink', {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        ...(contentType ? { 'X-Upload-Content-Type': contentType } : {}),
        'X-Upload-Content-Length': String(size),
      },
      body: JSON.stringify({ name: filename, parents: [parentId], ...(metadata.appProperties ? { appProperties: metadata.appProperties } : {}) }),
    });
    if (!init.ok) throw new Error(`Drive resumable init failed: ${init.status} ${(await init.text()).slice(0, 200)}`);
    const session = init.headers.get('location');
    if (!session) throw new Error('Drive resumable init: no session URL');
    const put = await fetch(session, {
      method: 'PUT',
      signal: AbortSignal.timeout(15 * 60 * 1000),
      headers: { ...(contentType ? { 'Content-Type': contentType } : {}), 'Content-Length': String(size) },
      body: stream,
      duplex: 'half',
    });
    const text = await put.text();
    if (!put.ok) throw new Error(`Drive stream upload failed: ${put.status} ${text.slice(0, 200)}`);
    let json = {};
    try { json = JSON.parse(text); } catch { /* Google 偶回空 body */ }
    // 補齊 webViewLink(resumable 完成回應不一定帶 fields)
    if (json.id && !json.webViewLink) {
      const meta = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(json.id)}?fields=id,webViewLink,size`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (meta.ok) json = { ...json, ...(await meta.json()) };
    }
    return json; // { id, webViewLink, size? }
  }

  const attachmentFields = 'id,name,size,md5Checksum,webViewLink,parents,appProperties,trashed';
  const quote = value => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  async function findAttachment(parentId, identity) {
    const token = await getAccessToken();
    const q = [`'${quote(parentId)}' in parents`, 'trashed = false',
      ...Object.entries(identity).map(([key, value]) => `appProperties has { key='${quote(key)}' and value='${quote(value)}' }`)].join(' and ');
    const params = new URLSearchParams({ q, pageSize: '2', fields: `files(${attachmentFields})`, supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw Object.assign(new Error('Drive attachment lookup failed'), { code: 'attachment_drive_lookup_failed' });
    const result = await response.json();
    if (!Array.isArray(result.files)) throw new Error('Drive attachment lookup incomplete');
    if (result.files.length > 1) throw Object.assign(new Error('Duplicate archived originals require review'), { code: 'attachment_drive_duplicate' });
    return result.files[0] || null;
  }

  async function verifyAttachment(fileId, parentId, identity, expectedSize = 0, expectedMd5 = '') {
    if (!fileId) throw new Error('Drive archive has no file id');
    const token = await getAccessToken();
    const params = new URLSearchParams({ fields: attachmentFields, supportsAllDrives: 'true' });
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw Object.assign(new Error('Drive archive verification failed'), { code: 'attachment_drive_verify_failed' });
    const file = await response.json();
    if (file.trashed || !file.parents?.includes(parentId) || Object.entries(identity).some(([k, v]) => file.appProperties?.[k] !== v)) {
      throw Object.assign(new Error('Drive archive ownership mismatch'), { code: 'attachment_drive_owner_mismatch' });
    }
    if (!Number(file.size) || (expectedSize > 0 && Number(file.size) !== expectedSize)) {
      throw Object.assign(new Error('Drive archive size mismatch'), { code: 'attachment_drive_size_mismatch' });
    }
    if (expectedMd5 && file.md5Checksum !== expectedMd5) {
      throw Object.assign(new Error('Drive archive checksum mismatch'), { code: 'attachment_drive_checksum_mismatch' });
    }
    return { ...file, webViewLink: file.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view` };
  }

  async function verifyWithinRoot(fileId, rootId, tenantKey) {
    const token = await getAccessToken();
    async function metadata(id) {
      const params = new URLSearchParams({ fields: attachmentFields, supportsAllDrives: 'true' });
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?${params}`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) throw new Error('Legacy Drive original unavailable');
      const file = await r.json();
      if (file.trashed || (file.appProperties?.amTenant && file.appProperties.amTenant !== tenantKey)) throw new Error('Legacy Drive original ownership invalid');
      return file;
    }
    const file = await metadata(fileId);
    if (!Number(file.size) || !file.md5Checksum) throw new Error('Legacy Drive original has no binary checksum');
    const parents = [...(file.parents || [])], seen = new Set();
    while (parents.length && seen.size < 64) {
      const parent = parents.shift();
      if (parent === rootId) return { ...file, webViewLink: file.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view` };
      if (seen.has(parent)) continue;
      seen.add(parent);
      parents.push(...((await metadata(parent)).parents || []));
    }
    throw new Error('Legacy Drive original is outside configured tenant root');
  }

  async function download(fileId, maxBytes = 30 * 1024 * 1024) {
    const id = String(fileId || '').trim();
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) throw new Error('Drive file id is invalid');
    const token = await getAccessToken();
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Drive download failed: ${response.status}`);
    const declared = Number(response.headers.get('content-length') || 0);
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error('Drive file exceeds download limit');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > maxBytes) throw new Error('Drive file size is invalid');
    return { buffer, contentType: response.headers.get('content-type') || 'application/octet-stream' };
  }

  async function streamDownload(fileId) {
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(String(fileId || ''))) throw new Error('Drive file id is invalid');
    const token = await getAccessToken();
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(900000),
    });
    if (!r.ok) throw Object.assign(new Error('Drive original download failed'), { code: 'attachment_drive_download_failed' });
    return { stream: r.body, contentLength: Number(r.headers.get('content-length')) || 0 };
  }

  async function auditPrivateFile(fileId) {
    const id = String(fileId || '').trim();
    if (!/^[A-Za-z0-9_-]{3,200}$/.test(id)) throw new Error('Drive file id is invalid');
    const token = await getAccessToken();
    const fields = 'nextPageToken,permissions(id,type,role,domain,allowFileDiscovery,permissionDetails(permissionType,inherited,role))';
    const permissions = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({
        supportsAllDrives: 'true',
        pageSize: '100',
        fields,
        ...(pageToken ? { pageToken } : {}),
      });
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/permissions?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const metadata = await response.json().catch(() => ({}));
      if (!response.ok) {
        logger.warn?.('Drive privacy audit request failed', {
          status: response.status,
          message: String(metadata?.error?.message || '').slice(0, 300),
        });
        throw Object.assign(new Error(`Drive privacy audit failed: ${response.status}`), {
          code: 'DRIVE_PRIVACY_AUDIT_REQUEST_FAILED',
        });
      }
      if (!Array.isArray(metadata.permissions)) {
        throw Object.assign(new Error('Drive privacy audit returned incomplete metadata'), { code: 'DRIVE_PRIVACY_AUDIT_INCOMPLETE' });
      }
      permissions.push(...metadata.permissions);
      pageToken = String(metadata.nextPageToken || '');
    } while (pageToken);
    const broadPermissions = permissions.filter((permission) => (
      ['anyone', 'domain'].includes(permission?.type)
    ));
    if (broadPermissions.length > 0) {
      throw Object.assign(new Error('Drive file or inherited folder has anyone/domain sharing'), {
        code: 'DRIVE_BROAD_PERMISSION_FORBIDDEN',
      });
    }
    return {
      private: true,
      permissionCount: permissions.length,
      domainRestricted: false,
    };
  }

  async function copyOriginal(fileId,parentId,name,identity){
    const token=await getAccessToken();
    const sourceResponse=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,size,md5Checksum,trashed&supportsAllDrives=true`,
      {headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
    const source=await sourceResponse.json();
    if(!sourceResponse.ok||source.trashed||!Number(source.size)||!source.md5Checksum)throw Error('archive_drive_source_unavailable');
    const response=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/copy?fields=id&supportsAllDrives=true`,{
      method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({name:name||source.name,parents:[parentId],appProperties:identity}),signal:AbortSignal.timeout(90000)});
    const copied=await response.json();if(!response.ok||!copied.id)throw Error('archive_drive_copy_failed');
    return verifyAttachment(copied.id,parentId,identity,Number(source.size),source.md5Checksum);
  }
  return { configured, getAccessToken, ensureFolder, upload, uploadStream, download, streamDownload, copyOriginal, auditPrivateFile, findAttachment, verifyAttachment, verifyWithinRoot };
}
