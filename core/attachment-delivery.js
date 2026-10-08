import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import {mediaFilename,asciiDownloadFilename,normalizedMediaType} from './media-filename.js';

export const ATTACHMENT_DELIVERY_CONTRACT = 'line-quoted-image-signed-download-v1';
export const ATTACHMENT_FILENAME_CONTRACT = 'verified-media-mime-filename-v1';
const TTL = 7200, IMAGE_MAX = 10 * 1024 * 1024;
const fail = () => { throw new Error('attachment_delivery_unavailable'); };

// Source lookup is supplied by the existing retrieval service, including its
// central archive references, transport routing, private sender and checksum gates.
export function createAttachmentDelivery({ platform, resolveConversation, resolveOriginal,
  fetchImpl = globalThis.fetch, now = Date.now, logger = console }) {
  const secretFor = tenant => platform.publicLinkSecretForTenant?.(tenant) || platform.publicLinkSecret || '';
  const baseFor = tenant => platform.publicBaseUrlForTenant?.(tenant) || platform.publicBaseUrl || '';
  const signature = (data, secret) => crypto.createHmac('sha256', secret).update(`am-attachment-delivery-v1:${data}`).digest('base64url');
  function ready(tenant) {
    try { const u = new URL(baseFor(tenant)); return Boolean(secretFor(tenant) && u.protocol === 'https:' && !u.username && !u.password); }
    catch { return false; }
  }
  function link(tenant, event, command, file, mode) {
    if (!ready(tenant)) fail();
    const sender = event.source?.userId ? { userId: event.source.userId } : {};
    const source = event.source?.groupId ? { type: 'group', groupId: event.source.groupId, ...sender }
      : event.source?.roomId ? { type: 'room', roomId: event.source.roomId, ...sender }
        : { type: 'user', userId: event.source?.userId };
    const data = Buffer.from(JSON.stringify({ v: 1, tenant: tenant.key, source, command,
      fileId: file.fileId, md5: file.md5, size: file.size, mode, exp: Math.floor(now() / 1000) + TTL })).toString('base64url');
    const url = new URL(baseFor(tenant)); url.search = ''; url.hash = '';
    url.pathname = `${url.pathname.replace(/\/$/, '')}/line-attachment`;
    url.searchParams.set('tenant', tenant.key);
    url.searchParams.set('token', `${data}.${signature(data, secretFor(tenant))}`);
    if (url.href.length > 2000) fail();
    return url.href;
  }
  function verify(tenant, token) {
    if (!tenant || tenant.runtimeEnabled === false || !secretFor(tenant) || !token || token.length > 2400) fail();
    const [data, sig, extra] = token.split('.');
    if (!data || !sig || extra) fail();
    const expected = Buffer.from(signature(data, secretFor(tenant))), actual = Buffer.from(sig);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) fail();
    const p = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (p.v !== 1 || p.tenant !== tenant.key || !Number.isInteger(p.exp) || p.exp <= Math.floor(now() / 1000)
      || p.exp > Math.floor(now() / 1000) + TTL || !['download', 'image', 'preview'].includes(p.mode)
      || !p.command || !p.source || !['group', 'room', 'user'].includes(p.source.type)
      || !(p.source.groupId || p.source.roomId || p.source.userId)) fail();
    return p;
  }
  async function mime(file) {
    if (!platform.getDriveAccessToken) fail();
    const token = await platform.getDriveAccessToken();
    const response = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.fileId)}?fields=id,mimeType,size,md5Checksum,trashed&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) fail();
    const metadata = await response.json();
    if (metadata.trashed || metadata.id !== file.fileId || Number(metadata.size) !== file.size
      || String(metadata.md5Checksum).toLowerCase() !== file.md5.toLowerCase()) fail();
    return normalizedMediaType(metadata.mimeType);
  }
  async function messages(tenant, event, command, file) {
    // Legacy deployments retain their verified Google link until HTTPS signing is configured.
    if (!ready(tenant)) return [{ type: 'text', text: `已找到保存的原檔「${file.filename}」：\n${file.url}` }];
    const url = link(tenant, event, command, file, 'download');
    let contentType;
    try { contentType=await mime(file); }
    catch { logger.warn('[attachment-delivery] media metadata unavailable; original link retained'); }
    const filename=mediaFilename(file.filename,contentType);
    const result = [{ type: 'text', text: `已找到保存的原檔「${filename}」：\n原檔下載（有效 2 小時，過期可再次回覆取回）：\n${url}` }];
    if (file.size > 0 && file.size <= IMAGE_MAX) {
      try {
        if (['image/jpeg', 'image/png'].includes(contentType)) result.push({ type: 'image',
          originalContentUrl: link(tenant, event, command, file, 'image'),
          previewImageUrl: link(tenant, event, command, file, 'preview') });
      } catch { logger.warn('[attachment-delivery] photo preview unavailable; original link retained'); }
    }
    return result;
  }
  async function handleDownload(req, res, { url, tenant }) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    let valid = false;
    try {
      const p = verify(tenant, url.searchParams.get('token')); valid = true;
      const event = { type: 'message', source: p.source, message: { type: 'text' } };
      const current = await resolveConversation(event,p.command);
      if (current?.tenant?.key !== tenant.key || current.binding?.status !== '啟用' || current.tenant.runtimeEnabled === false) { valid = false; fail(); }
      const file = await resolveOriginal(tenant, event, p.command);
      if (file.fileId !== p.fileId || file.md5 !== p.md5 || file.size !== p.size) { valid = false; fail(); }
      const contentType = await mime(file);
      if (p.mode !== 'download' && (!['image/jpeg', 'image/png'].includes(contentType) || file.size > IMAGE_MAX)) fail();
      const latest = await resolveConversation(event,p.command);
      if (latest?.tenant?.key !== tenant.key || latest.binding?.status !== '啟用' || latest.tenant.runtimeEnabled === false) { valid = false; fail(); }
      const token = await platform.getDriveAccessToken();
      const response = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.fileId)}?alt=media&supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120000),
      });
      if (!response.ok || !response.body) fail();
      if (p.mode === 'preview') {
        const chunks = []; let size = 0;
        for await (const chunk of Readable.fromWeb(response.body)) {
          size += chunk.length; if (size > IMAGE_MAX) fail(); chunks.push(chunk);
        }
        const original = Buffer.concat(chunks);
        if (original.length !== file.size || crypto.createHash('md5').update(original).digest('hex') !== file.md5) fail();
        const preview = await sharp(original, { limitInputPixels: 40000000 }).rotate()
          .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#fff' }).jpeg({ quality: 75 }).toBuffer();
        if (preview.length > 1024 * 1024) fail();
        res.setHeader('Content-Type', 'image/jpeg'); res.end(preview);
      } else {
        res.setHeader('Content-Type', contentType);
        const filename = mediaFilename(file.filename,contentType);
        res.setHeader('Content-Disposition', `${p.mode === 'image' ? 'inline' : 'attachment'}; filename="${asciiDownloadFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/'/g, '%27')}`);
        await pipeline(Readable.fromWeb(response.body), res);
      }
    } catch {
      logger.warn('[attachment-delivery] download unavailable');
      if (res.headersSent || res.destroyed) { res.destroy(); return; }
      res.statusCode = valid ? 503 : 403;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(valid ? '目前無法讀取原檔備份，請稍後再試。' : '連結已失效，請回到 LINE 原訊息再次回覆取回。');
    }
  }
  return { messages, handleDownload, contract: ATTACHMENT_DELIVERY_CONTRACT, filenameContract:ATTACHMENT_FILENAME_CONTRACT, ready };
}
