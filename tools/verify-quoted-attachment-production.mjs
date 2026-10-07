// Run inside the actual deployment environment. Read-only: no LINE send, source
// write or file creation. Reports booleans/counts only, never identifiers or URLs.
import crypto from 'node:crypto';
import { loadTenants, buildDataSourceRegistry } from '../core/tenants.js';
import { createNotion } from '../core/notion.js';
import { createDrive } from '../core/drive.js';
import { createAttachmentDelivery } from '../core/attachment-delivery.js';

const quiet = { warn() {}, log() {}, info() {}, error() {} };
const tenants = loadTenants(process.env, quiet).filter(t => t.runtimeEnabled !== false);
const notion = createNotion({ token: process.env.NOTION_TOKEN, version: process.env.NOTION_VERSION || '2025-09-03', registry: buildDataSourceRegistry(tenants, quiet), logger: quiet });
const drive = createDrive({ clientId: process.env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET, refreshToken: process.env.GOOGLE_OAUTH_REFRESH_TOKEN, logger: quiet });
const platform = { publicBaseUrl: process.env.AMCORE_PUBLIC_BASE_URL, publicLinkSecret: process.env.AMCORE_QUEUE_ACCESS_KEY,
  publicBaseUrlForTenant: t => t.publicBaseUrl || process.env.AMCORE_PUBLIC_BASE_URL,
  publicLinkSecretForTenant: t => t.queueAccessKey || process.env.BUILD_QUEUE_ACCESS_KEY || process.env.AMCORE_QUEUE_ACCESS_KEY,
  getDriveAccessToken: drive.getAccessToken };
const delivery = createAttachmentDelivery({ platform, resolveConversation: async () => null, resolveOriginal: async () => null, logger: quiet });
const plain = p => (p?.rich_text || []).map(t => t.plain_text || t.text?.content || '').join('');
const report = { commit: process.env.RENDER_GIT_COMMIT || '', tenants: [] };
for (const tenant of tenants) {
  const result = { tenant: tenant.key, configured: delivery.ready(tenant), originalVerified: false, photoVerified: false, attempts: 0 };
  report.tenants.push(result);
  try {
    if (!result.configured || !tenant.dataSources.attachments) continue;
    const response = await notion.notionRequest(`/v1/data_sources/${encodeURIComponent(tenant.dataSources.attachments)}/query`, {
      method: 'POST', tenantKey: tenant.key, body: { page_size: 100, filter: { and: [
        { property: '保存狀態', select: { equals: '已保存' } },
        { property: '檔案大小', number: { less_than_or_equal_to: 1048576 } },
        { property: '檔案大小', number: { greater_than: 0 } },
      ] } },
    });
    const candidates = (response.results || []).filter(p => !p.archived && !p.in_trash && plain(p.properties?.['LINE 群組 ID']) && plain(p.properties?.['LINE 訊息 ID']));
    for (const page of candidates.slice(0, 8)) {
      result.attempts++;
      try {
        const p = page.properties, file = { fileId: plain(p['Drive 檔案 ID']), md5: plain(p['Drive MD5']).toLowerCase(), size: Number(p['檔案大小']?.number), filename: plain(p['檔案名稱']) };
        if (!/^[\w-]{10,200}$/.test(file.fileId) || !/^[a-f0-9]{32}$/.test(file.md5)) continue;
        const event = { source: { type: 'group', groupId: plain(p['LINE 群組 ID']) } }, command = { quotedMessageId: plain(p['LINE 訊息 ID']), filename: '' };
        const messages = await delivery.messages(tenant, event, command, file);
        const url = messages[0].text.split('\n').at(-1);
        // Restrict the verification destination to this tenant's configured service.
        if (new URL(url).origin !== new URL(platform.publicBaseUrlForTenant(tenant)).origin) continue;
        const original = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!original.ok) { await original.body?.cancel(); continue; }
        const bytes = Buffer.from(await original.arrayBuffer());
        if (bytes.length !== file.size || crypto.createHash('md5').update(bytes).digest('hex') !== file.md5) continue;
        result.originalVerified = true;
        if (messages[1]?.type === 'image') {
          const image = await fetch(messages[1].originalContentUrl, { signal: AbortSignal.timeout(30000) });
          if (image.ok) {
            const imageBytes = Buffer.from(await image.arrayBuffer());
            const preview = await fetch(messages[1].previewImageUrl, { signal: AbortSignal.timeout(30000) });
            const previewBytes = Buffer.from(await preview.arrayBuffer());
            result.photoVerified = imageBytes.equals(bytes) && preview.ok && preview.headers.get('content-type') === 'image/jpeg' && previewBytes.length <= 1048576;
          } else await image.body?.cancel();
        }
        if (result.photoVerified) break;
      } catch { /* Try another existing small source; no raw errors or records in logs. */ }
    }
  } catch { result.lookupUnavailable = true; }
}
console.log(JSON.stringify(report));
if (!report.tenants.every(t => t.configured) || !report.tenants.some(t => t.photoVerified)) process.exitCode = 1;
