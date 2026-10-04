// Durable, tenant-local LINE binary intake. Notion is the queue/index; Drive holds originals.
import { textItem } from './util.js';
import crypto from 'node:crypto';

export const ATTACHMENT_ARCHIVE_CONTRACT = 'drive-only-line-attachments-v2';
export const ATTACHMENT_ARCHIVE_PROPERTIES = {
  'LINE 訊息 ID': { rich_text: {} },
  'LINE 群組 ID': { rich_text: {} },
  '附件類型': { rich_text: {} },
  '保存狀態': { select: { options: ['待保存', '已保存', '重試中', '需要重傳', '保存失敗'].map(name => ({ name })) } },
  '保存嘗試': { number: {} },
  '下次重試': { date: {} },
  '保存時間': { date: {} },
  '保存錯誤': { rich_text: {} },
  'Drive 檔案 ID': { rich_text: {} },
  '保存通知': { rich_text: {} },
  '原檔 SHA256': { rich_text: {} },
  'Drive MD5': { rich_text: {} },
  'LINE 使用者 ID': { rich_text: {} },
  '來源類型': { rich_text: {} },
  '保存來源': { rich_text: {} },
  '保存識別': { rich_text: {} },
};
const plain = prop => (prop?.rich_text || []).map(x => x.plain_text || x.text?.content || '').join('');
const rt = value => ({ rich_text: value ? [textItem(String(value).slice(0, 1900))] : [] });
const failure = code => Object.assign(new Error(code), { code });
export function isArchiveEvent(event) {
  const message = event?.message;
  return event?.type === 'message' && Boolean(event.source?.groupId || event.source?.roomId || event.source?.userId)
    && ['image', 'file', 'video', 'audio'].includes(message?.type);
}

export function createAttachmentArchive({ platform, router, logger = console, now = Date.now, fetchImpl = fetch, requestSpacingMs = 350 }) {
  const locks = new Map();
  const schemas = new Set();
  const states = new Map();
  const draining = new Set();
  let resolveTransport = async () => null;
  let requestStart = Promise.resolve(), nextRequestAt = 0;
  async function request(tenant, path, options = {}) {
    for (let attempt = 0; ; attempt++) {
      const start = requestStart.catch(() => {}).then(async () => {
        const delay = Math.max(0, nextRequestAt - Date.now());
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        nextRequestAt = Date.now() + requestSpacingMs;
      });
      requestStart = start;
      await start;
      try { return await platform.notionRequest(path, { ...options, tenantKey: tenant.key }); }
      catch (error) {
        if (attempt >= 3 || !/Notion API failed: 429\b/.test(String(error.message))) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
      }
    }
  }
  async function locked(key, work) {
    const previous = locks.get(key) || Promise.resolve();
    const promise = previous.catch(() => {}).then(work);
    locks.set(key, promise);
    try { return await promise; } finally { if (locks.get(key) === promise) locks.delete(key); }
  }
  function enabled(tenant) {
    return Boolean(tenant && tenant.runtimeEnabled !== false);
  }
  async function ready(tenant) {
    if (!tenant?.dataSources?.attachments || !tenant.driveConfigured || !tenant.driveRootFolderId) {
      states.set(tenant.key, { ready: false, error: 'attachment_storage_not_configured' });
      throw failure('attachment_storage_not_configured');
    }
    if (schemas.has(tenant.key)) return;
    const schema = await request(tenant, `/v1/data_sources/${encodeURIComponent(tenant.dataSources.attachments)}`, { method: 'GET' });
    for (const [name, definition] of Object.entries(ATTACHMENT_ARCHIVE_PROPERTIES)) {
      if (schema.properties?.[name]?.type !== Object.keys(definition)[0]) {
        states.set(tenant.key, { ready: false, error: 'attachment_archive_schema_missing' });
        throw failure('attachment_archive_schema_missing');
      }
    }
    schemas.add(tenant.key);
    states.set(tenant.key, { ready: true });
  }
  async function persist({ tenant, event, messagePage, binding }) {
    const message = event.message;
    const groupId = event.source?.groupId || event.source?.roomId;
    const userId = event.source?.userId || '';
    const sourceKind = groupId ? 'group' : 'direct';
    const messageId = String(message.id || '');
    if ((!groupId && !userId) || !messageId) throw failure('attachment_source_missing');
    await ready(tenant);
    return locked(`intake:${tenant.key}:${messageId}`, async () => {
      const found = await request(tenant, `/v1/data_sources/${encodeURIComponent(tenant.dataSources.attachments)}/query`, {
        method: 'POST', body: { page_size: 2, filter: { property: 'LINE 訊息 ID', rich_text: { equals: messageId } } },
      });
      if (found.results?.length > 1) throw failure('attachment_source_ambiguous');
      let page = found.results?.[0];
      if (page && (plain(page.properties?.['LINE 群組 ID']) !== (groupId || '')
        || (sourceKind === 'direct' && plain(page.properties?.['LINE 使用者 ID']) !== userId))) throw failure('attachment_source_group_conflict');
      if (!page) {
        const filename = message.fileName || `${message.type}-${messageId}${message.type === 'video' ? '.mp4' : message.type === 'audio' ? '.m4a' : ''}`;
        page = await request(tenant, '/v1/pages', {
          method: 'POST', body: { parent: { type: 'data_source_id', data_source_id: tenant.dataSources.attachments }, properties: {
            '附件項目': { title: [textItem(filename.slice(0, 1900))] },
            '檔案名稱': rt(filename), '檔案大小': { number: Number(message.fileSize) || null },
            '日期': { date: { start: new Date(event.timestamp || now()).toISOString() } },
            'LINE 訊息 ID': rt(messageId), 'LINE 群組 ID': rt(groupId), '附件類型': rt(message.type),
            'LINE 使用者 ID': rt(userId), '來源類型': rt(sourceKind), '保存來源': rt('line'),
            '保存識別': rt(messageId),
            '保存狀態': { select: { name: '待保存' } }, '保存嘗試': { number: 0 },
            '保存錯誤': rt(''), '下次重試': { date: { start: new Date(now()).toISOString() } },
            ...(messagePage?.id ? { '訊息': { relation: [{ id: messagePage.id }] } } : {}),
            ...(binding?.projectPageId ? { '專案': { relation: [{ id: binding.projectPageId }] } } : {}),
          } },
        });
      } else {
        const properties = {};
        if (messagePage?.id && !page.properties?.['訊息']?.relation?.some(x => x.id === messagePage.id)) properties['訊息'] = { relation: [{ id: messagePage.id }] };
        if (binding?.projectPageId && !page.properties?.['專案']?.relation?.some(x => x.id === binding.projectPageId)) properties['專案'] = { relation: [{ id: binding.projectPageId }] };
        if (Object.keys(properties).length) page = await request(tenant, `/v1/pages/${encodeURIComponent(page.id)}`, { method: 'PATCH', body: { properties } });
      }
      return page;
    });
  }
  async function capture(events, options = {}) {
    const captured = new Map();
    for (const event of events) {
      if (!isArchiveEvent(event) || (typeof options === 'function' && options(event))) continue;
      const groupId = event.source.groupId || event.source.roomId;
      const result = options.ownsTransport?.(event)
        ? await resolveTransport(event)
        : groupId ? await router.resolveGroupBinding(groupId)
          : await router.resolveDirectAttachmentBinding(event.source.userId);
      if (['lookup_failed', 'ambiguous'].includes(result?.resolution || result?.reason)) throw failure('attachment_tenant_unresolved');
      if (!result?.tenant || !result.binding || !enabled(result.tenant)) continue;
      await persist({ tenant: result.tenant, event, binding: result.binding });
      captured.set(result.tenant.key, result.tenant);
    }
    return [...captured.values()];
  }
  async function patch(tenant, page, properties) {
    return request(tenant, `/v1/pages/${encodeURIComponent(page.id)}`, { method: 'PATCH', body: { properties } });
  }
  async function notify(tenant, page, stage) {
    const notices = new Set(plain(page.properties?.['保存通知']).split(',').filter(Boolean));
    if (notices.has('legacy') || notices.has(stage) || (stage === 'recovered' && !notices.has('retry'))) return;
    if (typeof platform.pushLineMessage !== 'function') return;
    try {
      const groupId = plain(page.properties?.['LINE 群組 ID']);
      const userId = plain(page.properties?.['LINE 使用者 ID']);
      const current = groupId ? await router.resolveGroupBinding(groupId)
        : await router.resolveDirectAttachmentBinding(userId);
      // Only notify the still-active original tenant/group, never a re-bound or shadow group.
      if (current.tenant?.key !== tenant.key || current.binding?.status !== '啟用') return;
      const filename = plain(page.properties?.['檔案名稱']).slice(0, 160);
      const messages = {
        retry: `⚠ 附件「${filename}」尚未保存成功，系統正在重試。請先保留原檔。`,
        expired: `⚠ 附件「${filename}」無法從 LINE 下載，尚未保存原檔。請持有原檔的人重新上傳。`,
        failed: `⚠ 附件「${filename}」重試後仍未保存成功。請保留原檔並聯絡系統管理者處理。`,
        recovered: `附件「${filename}」已在重試後保存成功，原檔已留存。`,
      };
      await platform.pushLineMessage(groupId || userId, messages[stage], undefined, {
        retryKey: `attachment:${tenant.key}:${plain(page.properties?.['LINE 訊息 ID'])}:${stage}`,
      });
      notices.add(stage);
      await patch(tenant, page, { '保存通知': rt([...notices].join(',')) });
    } catch {
      logger.warn(`[attachment-archive] save-state notification unavailable tenant=${tenant.key}`);
    }
  }
  async function backupContent(props, migration = false) {
    const filename = plain(props['檔案名稱']);
    const backups = (props['檔案']?.files || []).filter(f => f.type === 'file' && (migration || f.name === filename) && f.file?.url);
    if (backups.length !== 1) throw failure('attachment_backup_missing_or_ambiguous');
    const url = new URL(backups[0].file.url);
    if (url.protocol !== 'https:' || !(url.hostname.endsWith('.amazonaws.com') || url.hostname === 'file.notion.so')) throw failure('attachment_backup_host_invalid');
    const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(15 * 60 * 1000) });
    if (!response.ok) throw failure('attachment_backup_download_failed');
    return { stream: response.body, contentLength: Number(response.headers.get('content-length')) || Number(props['檔案大小']?.number) || 0,
      contentType: response.headers.get('content-type') || 'application/octet-stream' };
  }
  async function digest(content) {
    const sha = crypto.createHash('sha256'), md5 = crypto.createHash('md5');
    let size = 0;
    for await (const chunk of content.stream) { size += chunk.byteLength; sha.update(chunk); md5.update(chunk); }
    if (!size || (content.contentLength && size !== Number(content.contentLength))) throw failure('attachment_received_size_mismatch');
    return { size, sha256: sha.digest('hex'), md5: md5.digest('hex') };
  }
  async function saveResult(tenant, page, driveFile, sourceSha256, sourceMd5) {
    await patch(tenant, page, {
      '保存狀態': { select: { name: '已保存' } }, '保存時間': { date: { start: new Date(now()).toISOString() } },
      'Drive 檔案 ID': rt(driveFile.id), 'Drive 連結': { url: driveFile.webViewLink },
      '檔案大小': { number: Number(driveFile.size) }, '保存錯誤': rt(''), '下次重試': { date: null },
      '原檔 SHA256': rt(sourceSha256), 'Drive MD5': rt(driveFile.md5Checksum || sourceMd5),
      // Clear binary references only after original storage has been verified.
      '檔案': { files: [] },
    });
  }
  function driveId(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' || u.hostname !== 'drive.google.com') return '';
      const id = u.pathname.match(/^\/file\/d\/([\w-]+)/)?.[1] || u.searchParams.get('id');
      return /^[\w-]{10,200}$/.test(id || '') ? id : '';
    } catch { return ''; }
  }
  async function process(tenant, inputPage, migrate = false) {
    return locked(`save:${tenant.key}:${inputPage.id}`, async () => {
      const scopedQueryPage = migrate && String(inputPage.parent?.data_source_id || '').replace(/-/g, '') === String(tenant.dataSources.attachments).replace(/-/g, '');
      const page = scopedQueryPage ? inputPage : await request(tenant, `/v1/pages/${encodeURIComponent(inputPage.id)}`, { method: 'GET' });
      const props = page.properties || {};
      if (migrate) props['保存來源'] = rt('notion-migration');
      const status = props['保存狀態']?.select?.name;
      if (!migrate && ['需要重傳', '保存失敗'].includes(status)) return { attachmentPage: page, saved: false, status };
      const migration = plain(props['保存來源']) === 'notion-migration';
      const messageId = plain(props['保存識別']) || plain(props['LINE 訊息 ID']) || (migration ? `notion:${page.id}` : '');
      const filename = plain(props['檔案名稱']) || (migration ? props['檔案']?.files?.[0]?.name : '');
      const groupId = plain(props['LINE 群組 ID']);
      const userId = plain(props['LINE 使用者 ID']);
      const expectedSize = migration ? 0 : Number(props['檔案大小']?.number) || 0;
      if (!messageId || !filename || (!groupId && !userId && !migration)) throw failure('attachment_source_missing');
      if (!migrate && status === '已保存') return { attachmentPage: page, saved: true, driveFile: {
        id: plain(props['Drive 檔案 ID']), webViewLink: props['Drive 連結']?.url, size: expectedSize,
      } };
      if (status === '重試中' && new Date(props['下次重試']?.date?.start).getTime() > now()) {
        return { attachmentPage: page, saved: false, status };
      }
      const attempt = (Number(props['保存嘗試']?.number) || 0) + 1;
      const due = new Date(now() + Math.min(600000, 30000 * 2 ** Math.min(attempt - 1, 5))).toISOString();
      // Persist the attempt before network transfer so a process exit remains recoverable.
      await patch(tenant, page, { '保存嘗試': { number: attempt }, '保存狀態': { select: { name: '重試中' } }, '下次重試': { date: { start: due } },
        ...(migration ? { '保存來源': rt('notion-migration'), '保存識別': rt(messageId), '保存通知': rt('legacy'),
          '來源類型': props['來源類型'] || rt('historical') } : {}),
      });
      let stream;
      let driveFile;
      let transferSize = expectedSize;
      let sourceSha256 = plain(props['原檔 SHA256']);
      let sourceMd5 = plain(props['Drive MD5']);
      try {
        if (!tenant.driveConfigured || !tenant.driveRootFolderId) throw failure('attachment_storage_not_configured');
        if (migration) {
          const existingId = driveId(props['Drive 連結']?.url);
          if (existingId) {
            // Reuse an existing original only after independent source hashing and
            // verifying that its parent chain reaches this tenant's configured root.
            let existing;
            try { existing = await platform.drive.verifyWithinRoot(existingId, tenant.driveRootFolderId, tenant.key); }
            catch { /* A missing/moved/wrong-root original is replaced from Notion. */ }
            if (existing) {
              const indexedSize = Number(props['檔案大小']?.number) || 0;
              // A successful final PATCH can lose its response after removing the
              // Notion copy. Its already computed digests make that retry safe.
              const original = !(props['檔案']?.files || []).length && /^[a-f0-9]{64}$/.test(sourceSha256) && /^[a-f0-9]{32}$/.test(sourceMd5) && indexedSize > 0
                ? { size: indexedSize, sha256: sourceSha256, md5: sourceMd5 }
                : await digest(await backupContent(props, true));
              if (Number(existing.size) === original.size && existing.md5Checksum === original.md5) {
                sourceSha256 = original.sha256; sourceMd5 = original.md5; transferSize = original.size;
                await saveResult(tenant, page, existing, sourceSha256, sourceMd5);
                return { attachmentPage: page, saved: true, driveFile: existing };
              }
            }
          }
        }
        const date = new Date(new Date(props['日期']?.date?.start || now()).getTime() + 8 * 3600000).toISOString().slice(0, 10);
        const privateSource = plain(props['來源類型']) === 'direct';
        let root = await platform.ensureDriveFolder(privateSource ? '私人附件' : '未歸檔', tenant.driveRootFolderId);
        if (privateSource) root = await platform.ensureDriveFolder(crypto.createHash('sha256').update(userId).digest('hex').slice(0, 24), root);
        const folder = await platform.ensureDriveFolder(date, root);
        const identity = { amTenant: tenant.key, amLineMessage: messageId };
        driveFile = await platform.drive.findAttachment(folder, identity);
        if (!driveFile) {
          let content;
          try { content = migration ? await backupContent(props, true) : await platform.streamLineContent(messageId); }
          catch (sourceError) {
            // A recovered Notion-managed original is durable evidence too. Read the
            // freshly signed internal file URL only; never fetch arbitrary external links.
            if (migration || !(props['檔案']?.files || []).some(f => f.type === 'file' && f.name === filename)) throw sourceError;
            content = await backupContent(props);
          }
          stream = content.stream;
          const size = Number(content.contentLength) || expectedSize;
          if (!stream || !size || (expectedSize && size !== expectedSize)) throw failure('attachment_source_size_invalid');
          transferSize = size;
          let receivedBytes = 0;
          const sha = crypto.createHash('sha256');
          const md5 = crypto.createHash('md5');
          const counted = stream.pipeThrough(new TransformStream({ transform(chunk, controller) {
            const bytes = Buffer.from(chunk); receivedBytes += bytes.length;
            sha.update(bytes); md5.update(bytes); controller.enqueue(chunk);
          } }));
          stream = counted;
          driveFile = await platform.uploadDriveStream(counted, filename, content.contentType, folder, size, { appProperties: identity });
          if (receivedBytes !== size) throw failure('attachment_received_size_mismatch');
          sourceSha256 = sha.digest('hex'); sourceMd5 = md5.digest('hex');
        }
        // The upload response alone is insufficient: read storage metadata and check size/parent/identity.
        driveFile = await platform.drive.verifyAttachment(driveFile.id, folder, identity, transferSize, sourceMd5);
        await saveResult(tenant, page, driveFile, sourceSha256, sourceMd5);
        logger.log(`[attachment-archive] saved tenant=${tenant.key} bytes=${driveFile.size}`);
        await notify(tenant, page, 'recovered');
        return { attachmentPage: page, saved: true, driveFile };
      } catch (error) {
        try { await stream?.cancel?.(); } catch { /* an upload may already own the reader */ }
        const expired = /LINE content download failed: (404|410)\b/.test(String(error.message));
        const nextStatus = expired ? '需要重傳' : attempt >= 8 ? '保存失敗' : '重試中';
        // Do not store provider response bodies, URLs or credentials in the index/log.
        const reason = expired ? 'LINE 原檔已無法下載，請由來源持有人重傳。' : (error.code || 'attachment_transfer_or_index_failed');
        await patch(tenant, page, {
          '保存狀態': { select: { name: nextStatus } }, '保存錯誤': rt(reason),
          '下次重試': { date: nextStatus === '重試中' ? { start: due } : null },
          // Preserve computed source digests if the final index write failed.
          ...(sourceSha256 ? { '原檔 SHA256': rt(sourceSha256), 'Drive MD5': rt(sourceMd5), '檔案大小': { number: transferSize } } : {}),
        });
        logger.error(`[attachment-archive] unsaved tenant=${tenant.key} state=${nextStatus} attempt=${attempt} reason=${reason}`);
        await notify(tenant, page, expired ? 'expired' : nextStatus === '保存失敗' ? 'failed' : 'retry');
        return { attachmentPage: page, saved: false, status: nextStatus };
      }
    });
  }
  async function drain(tenant) {
    if (!enabled(tenant) || draining.has(tenant.key)) return;
    draining.add(tenant.key);
    try {
      await ready(tenant);
      const result = await request(tenant, `/v1/data_sources/${encodeURIComponent(tenant.dataSources.attachments)}/query`, {
        method: 'POST', body: { page_size: 10, sorts: [{ property: '下次重試', direction: 'ascending' }], filter: { and: [
          { or: ['待保存', '重試中'].map(name => ({ property: '保存狀態', select: { equals: name } })) },
          { property: '下次重試', date: { on_or_before: new Date(now()).toISOString() } },
        ] } },
      });
      let retryPending = false;
      for (const page of result.results || []) {
        const saved = await process(tenant, page);
        retryPending ||= !saved.saved;
      }
      // Old managed originals are themselves durable intake. Mark the attempt
      // before transferring, and retain their binary reference on every failure.
      const legacy = await request(tenant, `/v1/data_sources/${encodeURIComponent(tenant.dataSources.attachments)}/query`, {
        method: 'POST', body: { page_size: 20, filter: { and: [
          { property: '檔案', files: { is_not_empty: true } },
          { property: '保存來源', rich_text: { is_empty: true } },
        ] } },
      });
      const pendingLegacy = [...(legacy.results || [])];
      // Bound concurrent transfers; Notion requests still share the rate gate.
      await Promise.all(Array.from({ length: 3 }, async () => { while (pendingLegacy.length) {
        const page = pendingLegacy.shift();
        if ((page.properties?.['檔案']?.files || []).filter(f => f.type === 'file').length !== 1) {
          await patch(tenant, page, { '保存來源': rt('manual-review'), '保存錯誤': rt('Historical original is not a single managed file; manual review required.') });
          continue;
        }
        const saved = await process(tenant, page, true);
        retryPending ||= !saved.saved;
      } }));
      // Delivery is independent from transfer retries: a temporary LINE push failure
      // must not suppress the terminal warning or the later recovery notice.
      const noticeScope = [
        { property: 'LINE 群組 ID', rich_text: { is_not_empty: true } },
        { property: '保存通知', rich_text: { does_not_contain: 'legacy' } },
      ];
      // Notion supports only two levels of compound filters: OR of flat ANDs.
      const notices = await request(tenant, `/v1/data_sources/${encodeURIComponent(tenant.dataSources.attachments)}/query`, {
        method: 'POST', body: { page_size: 10, filter: { or: [
          { and: [...noticeScope, { property: '保存狀態', select: { equals: '需要重傳' } }, { property: '保存通知', rich_text: { does_not_contain: 'expired' } }] },
          { and: [...noticeScope, { property: '保存狀態', select: { equals: '保存失敗' } }, { property: '保存通知', rich_text: { does_not_contain: 'failed' } }] },
          { and: [...noticeScope, { property: '保存狀態', select: { equals: '已保存' } }, { property: '保存通知', rich_text: { contains: 'retry' } }, { property: '保存通知', rich_text: { does_not_contain: 'recovered' } }] },
        ] } },
      });
      for (const page of notices.results || []) {
        const status = page.properties?.['保存狀態']?.select?.name;
        await notify(tenant, page, status === '需要重傳' ? 'expired' : status === '保存失敗' ? 'failed' : 'recovered');
      }
      const failures = await request(tenant, `/v1/data_sources/${encodeURIComponent(tenant.dataSources.attachments)}/query`, {
        method: 'POST', body: { page_size: 1, filter: { or: ['需要重傳', '保存失敗'].map(name => ({ property: '保存狀態', select: { equals: name } })) } },
      });
      states.set(tenant.key, { ready: true, checkedAt: new Date(now()).toISOString(), retryPending,
        backlog: Boolean(result.has_more || legacy.has_more), migrating: Boolean(legacy.results?.length),
        needsAttention: retryPending || Boolean(failures.results?.length) });
    } catch (error) {
      states.set(tenant.key, { ready: false, error: error.code || 'attachment_queue_unavailable' });
      logger.error(`[attachment-archive] queue unavailable tenant=${tenant.key}`);
    } finally { draining.delete(tenant.key); }
  }
  function health(tenant) {
    return { contract: ATTACHMENT_ARCHIVE_CONTRACT, enabled: enabled(tenant), configured: Boolean(tenant?.driveConfigured && tenant?.driveRootFolderId && tenant?.dataSources?.attachments), ...(states.get(tenant.key) || { ready: false, unchecked: true }) };
  }
  return { contract: ATTACHMENT_ARCHIVE_CONTRACT, capture, persist, process, drain, health,
    setTransportResolver(fn) { resolveTransport = typeof fn === 'function' ? fn : async () => null; } };
}
