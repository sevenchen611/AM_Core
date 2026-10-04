import assert from 'node:assert/strict';
import test from 'node:test';
import { createAttachmentArchive, ATTACHMENT_ARCHIVE_PROPERTIES, isArchiveEvent } from '../core/attachment-archive.js';
import { createDrive } from '../core/drive.js';
import collect from '../modules/collect/index.js';
import meetings, { __test as meetingTest } from '../modules/meetings/index.js';
import crypto from 'node:crypto';
import { createRouter } from '../core/router.js';

const quiet = { log() {}, warn() {}, error() {} };
const event = (type = 'file', extra = {}) => ({ type: 'message', timestamp: Date.UTC(2026, 8, 23, 6, 42),
  source: { groupId: 'test-group', userId: 'test-sender' },
  message: { id: 'test-message', type, fileName: 'test-water.pdf', fileSize: 40647423, ...extra } });
const tenant = (key = 'hozo-am-2-0') => ({ key, modules: ['collect'], driveConfigured: true,
  driveRootFolderId: `${key}-drive`, dataSources: { attachments: `${key}-attachments`, messages: `${key}-messages` }, config: {} });

function harness(options = {}) {
  const rows = options.rows || new Map();
  const files = options.files || new Map();
  const calls = [];
  const t = options.tenant || tenant();
  let clock = Date.UTC(2026, 8, 23, 6, 42);
  let nextId = rows.size;
  const router = { resolveGroupBinding: async () => ({ tenant: options.currentTenant || t, binding: { groupId: 'test-group', status: options.bindingStatus || '啟用' }, resolution: options.resolution || 'active' }),
    resolveDirectAttachmentBinding: async userId => ({tenant:options.currentTenant || t,binding:{kind:'direct',userId,status:'啟用'},reason:options.resolution || 'bound'}) };
  const platform = {
    logger: quiet,
    pushLineMessage: async (...args) => { calls.push(['notice', ...args]); if (options.noticeError) throw new Error('Temporary LINE push failure'); },
    notionRequest: async (path, opts = {}) => {
      calls.push(['notion', path, opts]);
      assert.equal(opts.tenantKey, t.key, 'every queue request must be scoped to the tenant');
      if (options.notionUnavailable) throw new Error('Notion temporarily down');
      if (/data_sources\/[^/]+$/.test(path)) return { properties: options.schemaMissing ? {} : Object.fromEntries(Object.entries(ATTACHMENT_ARCHIVE_PROPERTIES).map(([k,v]) => [k,{ type: Object.keys(v)[0] }])) };
      if (path.endsWith('/query')) {
        const f = opts.body.filter;
        function validateNesting(filter, depth = 0) {
          const children = filter.and || filter.or;
          if (!children) return;
          assert.ok(depth < 2, 'Notion compound filters allow at most two levels');
          children.forEach(child => validateNesting(child, depth + 1));
        }
        validateNesting(f);
        const dataSourceId = path.split('/')[3];
        let results = [...rows.values()].filter(p => p.parent?.data_source_id === dataSourceId);
        function match(p, filter) {
          if (filter.and) return filter.and.every(f => match(p,f));
          if (filter.or) return filter.or.some(f => match(p,f));
          const prop = p.properties[filter.property];
          if (filter.select) return prop?.select?.name === filter.select.equals;
          if (filter.date) return new Date(prop?.date?.start).getTime() <= new Date(filter.date.on_or_before).getTime();
          if (filter.files) return filter.files.is_not_empty ? Boolean(prop?.files?.length) : !prop?.files?.length;
          const text = prop?.rich_text?.map(x=>x.plain_text||x.text?.content||'').join('') || '';
          if (filter.rich_text.is_empty) return !text;
          if (filter.rich_text.equals !== undefined) return text === filter.rich_text.equals;
          if (filter.rich_text.is_not_empty) return Boolean(text);
          if (filter.rich_text.contains !== undefined) return text.includes(filter.rich_text.contains);
          if (filter.rich_text.does_not_contain !== undefined) return !text.includes(filter.rich_text.does_not_contain);
          throw new Error('Unexpected query filter');
        }
        results = results.filter(p => match(p,f));
        return { results: structuredClone(results.slice(0, opts.body.page_size)), has_more: results.length > opts.body.page_size };
      }
      if (path === '/v1/pages') {
        const page = { id: `page-${++nextId}`, parent: structuredClone(opts.body.parent), properties: structuredClone(opts.body.properties) };
        rows.set(page.id, page);
        return structuredClone(page);
      }
      const page = rows.get(path.split('/').at(-1));
      assert.ok(page, `page exists: ${path}`);
      if (opts.method === 'PATCH') {
        if (options.failFinalPatch && opts.body.properties['保存狀態']?.select?.name === '已保存') {
          options.failFinalPatch = false;
          if (options.appliedLostPatch) Object.assign(page.properties, structuredClone(opts.body.properties));
          throw new Error('Notion response lost after Drive upload');
        }
        Object.assign(page.properties, structuredClone(opts.body.properties));
      }
      return structuredClone(page);
    },
    ensureDriveFolder: async (name, parent) => { calls.push(['folder', name, parent]); return `${parent}/${name}`; },
    streamLineContent: async id => {
      calls.push(['stream', id]);
      if (options.lineError) throw new Error(options.lineError);
      let remaining = options.payloadLength ?? options.contentLength ?? 40647423;
      return { stream: new ReadableStream({ pull(c) {
        if (!remaining) { c.close(); return; }
        const n = Math.min(65536, remaining); c.enqueue(new Uint8Array(n).fill(7)); remaining -= n;
      } }), contentType: 'application/pdf', contentLength: options.contentLength ?? 40647423 };
    },
    uploadDriveStream: async (stream, name, type, folder, size, meta) => {
      calls.push(['upload', folder, size, meta]);
      if (options.uploadError) throw new Error('Temporary Drive error');
      const md5 = crypto.createHash('md5');
      let received = 0;
      for await (const chunk of stream) { received += chunk.byteLength; md5.update(chunk); }
      const file = { id: `file-${files.size + 1}`, name, size:received, md5Checksum:md5.digest('hex'), webViewLink: 'https://drive.example/test', folder, identity: meta.appProperties };
      files.set(file.id, file);
      return file;
    },
    drive: {
      verifyWithinRoot: async () => { if (!options.legacyFile) throw new Error('Legacy file outside root'); return options.legacyFile; },
      findAttachment: async (folder, identity) => [...files.values()].find(f => f.folder === folder && JSON.stringify(f.identity) === JSON.stringify(identity)),
      verifyAttachment: async (id, folder, identity, size, checksum) => {
        calls.push(['verify', id]);
        const f = files.get(id);
        assert.equal(f.folder, folder);
        assert.deepEqual(f.identity, identity);
        assert.equal(f.size, size);
        if (checksum) assert.equal(f.md5Checksum, checksum);
        if (options.verifyError) throw Object.assign(new Error('size mismatch'), { code: 'attachment_drive_size_mismatch' });
        return f;
      },
    },
    downloadLineContent: async () => { calls.push(['buffer']); throw new Error('Large originals must not buffer'); },
    uploadFileToNotion: async () => { calls.push(['preview']); throw new Error('Preview is optional'); },
  };
  const makeArchive = () => createAttachmentArchive({ platform, router, logger: quiet, now: () => clock, requestSpacingMs:0, fetchImpl: options.fetchImpl || (() => { throw new Error('Unexpected external fetch'); }) });
  const archive = makeArchive();
  platform.attachmentArchive = archive;
  return { archive, platform, rows, files, calls, options, t, makeArchive, advance: () => { clock += 600000; } };
}

test('ordinary 38.8 MB PDF is persisted before acknowledgement and streams in every collect tenant', async () => {
  for (const key of ['hozo-am-2-0', 'engineering', 'forest', 'green-hotel', 'future-tenant']) {
    const h = harness({ tenant: tenant(key) });
    const captured = await h.archive.capture([event()]);
    assert.equal(captured[0].key, key);
    assert.equal(h.rows.size, 1);
    assert.equal([...h.rows.values()][0].properties['保存狀態'].select.name, '待保存');
    assert.equal(h.calls.some(c => c[0] === 'upload'), false, 'pre-ack intake only persists recoverable jobs');
    await h.archive.drain(h.t);
    assert.equal([...h.rows.values()][0].properties['保存狀態'].select.name, '已保存');
    assert.equal(h.files.size, 1);
    assert.match([...h.rows.values()][0].properties['原檔 SHA256'].rich_text[0].text.content, /^[a-f0-9]{64}$/);
    assert.ok(h.calls.find(c => c[0] === 'upload')[1].startsWith(`${key}-drive/`));
    assert.equal(h.calls.some(c => ['buffer','preview'].includes(c[0])), false);
  }
});

test('restarts resume a queued job; LINE redelivery reuses the row and original', async () => {
  const h = harness();
  await Promise.all([h.archive.capture([event()]), h.archive.capture([event()])]);
  assert.equal(h.rows.size, 1);
  const afterRestart = h.makeArchive();
  await afterRestart.drain(h.t);
  await afterRestart.capture([event()]);
  await afterRestart.drain(h.t);
  assert.equal(h.rows.size, 1);
  assert.equal(h.files.size, 1);
  assert.equal(h.calls.filter(c => c[0] === 'upload').length, 1);
});

test('Drive failure is visible and persisted; restart retry succeeds', async () => {
  const h = harness({ uploadError: true });
  await h.archive.capture([event()]);
  await h.archive.drain(h.t);
  const p = [...h.rows.values()][0].properties;
  assert.equal(p['保存狀態'].select.name, '重試中');
  assert.equal(p['保存時間'], undefined);
  assert.ok(p['保存錯誤'].rich_text.length);
  assert.equal(h.archive.health(h.t).needsAttention, true);
  const queued = [...h.rows.values()][0];
  await h.archive.process(h.t, queued);
  assert.equal(h.calls.filter(c => c[0] === 'upload').length, 1, 'redelivery respects retry backoff');
  h.options.uploadError = false;
  h.advance();
  await h.makeArchive().drain(h.t);
  assert.equal([...h.rows.values()][0].properties['保存狀態'].select.name, '已保存');
  assert.match([...h.rows.values()][0].properties['原檔 SHA256'].rich_text[0].text.content, /^[a-f0-9]{64}$/);
});

test('index update failure after Drive success reuses the verified original on retry', async () => {
  const h = harness({ failFinalPatch: true });
  await h.archive.capture([event()]);
  await h.archive.drain(h.t);
  assert.equal(h.files.size, 1);
  assert.equal([...h.rows.values()][0].properties['保存狀態'].select.name, '重試中');
  h.advance();
  await h.makeArchive().drain(h.t);
  assert.equal(h.calls.filter(c => c[0] === 'upload').length, 1);
  assert.equal([...h.rows.values()][0].properties['保存狀態'].select.name, '已保存');
});

test('expired originals stop retrying with honest resend status', async () => {
  const h = harness({ lineError: 'LINE content download failed: 404 not found' });
  await h.archive.capture([event()]);
  await h.archive.drain(h.t);
  assert.equal([...h.rows.values()][0].properties['保存狀態'].select.name, '需要重傳');
  assert.equal([...h.rows.values()][0].properties['下次重試'].date, null);
  h.advance();
  await h.makeArchive().drain(h.t);
  assert.equal(h.calls.filter(c => c[0] === 'stream').length, 1);
  assert.equal(h.archive.health(h.t).needsAttention, true);
});

test('failures notify once, retries deduplicate and recovery notifies without repeating normal successes', async () => {
  const h = harness({ uploadError: true });
  await h.archive.capture([event()]);
  await h.archive.drain(h.t);
  h.advance(); await h.archive.drain(h.t);
  assert.equal(h.calls.filter(c => c[0] === 'notice').length, 1);
  h.options.uploadError = false;
  h.advance(); await h.archive.drain(h.t);
  assert.equal(h.calls.filter(c => c[0] === 'notice').length, 2);
  assert.ok(h.calls.filter(c => c[0] === 'notice').every(c => c[1] === 'test-group' && c[4].retryKey.includes(h.t.key)));
  await h.archive.drain(h.t);
  assert.equal(h.calls.filter(c => c[0] === 'notice').length, 2);
});

test('shadow or re-bound groups do not receive save-failure notifications', async () => {
  for (const bindingStatus of ['影子記錄', '停用']) {
    const h = harness({ bindingStatus, uploadError: true });
    await h.archive.capture([event()]); await h.archive.drain(h.t);
    assert.equal(h.calls.some(c => c[0] === 'notice'), false);
  }
  const h = harness({ uploadError: true });
  await h.archive.capture([event()]);
  h.options.currentTenant = tenant('another-tenant');
  await h.archive.drain(h.t);
  assert.equal(h.calls.some(c => c[0] === 'notice'), false);
});

test('a terminal save warning retries independently after a temporary notification failure', async () => {
  const h = harness({ lineError: 'LINE content download failed: 410 gone', noticeError: true });
  await h.archive.capture([event()]); await h.archive.drain(h.t);
  assert.equal([...h.rows.values()][0].properties['保存狀態'].select.name, '需要重傳');
  const failedPushes = h.calls.filter(c => c[0] === 'notice').length;
  h.options.noticeError = false;
  h.advance(); await h.makeArchive().drain(h.t);
  assert.equal(h.calls.filter(c => c[0] === 'stream').length, 1, 'notification recovery must not redownload an expired file');
  assert.equal(h.calls.filter(c => c[0] === 'notice').length, failedPushes + 1);
  assert.equal([...h.rows.values()][0].properties['保存通知'].rich_text[0].text.content, 'expired');
});

test('a matching Notion-managed original survives LINE expiry; arbitrary external backups are rejected', async () => {
  let fetched = 0;
  const h = harness({ lineError: 'LINE content download failed: 404 gone', fetchImpl: async () => {
    fetched++; return new Response(new Uint8Array(100), { headers: { 'content-length':'100', 'content-type':'application/pdf' } });
  } });
  await h.archive.capture([event('file', { fileSize: 100 })]);
  const p = [...h.rows.values()][0].properties;
  p['檔案'] = { files: [{ type:'file', name:'test-water.pdf', file:{ url:'https://prod-files-secure.s3.us-west-2.amazonaws.com/synthetic.pdf' } }] };
  await h.archive.drain(h.t);
  assert.equal(fetched, 1); assert.equal(p['保存狀態'].select.name, '已保存');
  const blocked = harness({ lineError: 'LINE content download failed: 404 gone' });
  await blocked.archive.capture([event()]);
  const b = [...blocked.rows.values()][0].properties;
  b['檔案'] = { files: [{ type:'file', name:'test-water.pdf', file:{ url:'http://127.0.0.1/private' } }] };
  await blocked.archive.drain(blocked.t);
  assert.equal(b['保存狀態'].select.name, '重試中');
  assert.equal(b['保存錯誤'].rich_text[0].text.content, 'attachment_backup_host_invalid');
});

test('eight unsuccessful transfers become an actionable permanent failure', async () => {
  const h = harness({ uploadError: true });
  await h.archive.capture([event()]);
  for (let i = 0; i < 8; i++) { await h.archive.drain(h.t); h.advance(); }
  const p = [...h.rows.values()][0].properties;
  assert.equal(p['保存狀態'].select.name, '保存失敗');
  assert.equal(p['保存嘗試'].number, 8);
  await h.archive.drain(h.t);
  assert.equal(h.calls.filter(c => c[0] === 'upload').length, 8);
});

test('missing schema/storage, ambiguous routes and Notion outage prevent successful intake', async () => {
  for (const options of [{ schemaMissing: true }, { notionUnavailable: true }, { resolution: 'ambiguous' }, { resolution: 'lookup_failed' }, { tenant: { ...tenant(), driveConfigured: false } }]) {
    const h = harness(options);
    await assert.rejects(h.archive.capture([event()]));
    assert.equal(h.files.size, 0);
  }
});

test('wrong content length or failed storage verification never marks an original saved', async () => {
  for (const opts of [{ contentLength: 10 }, { payloadLength: 10 }, { verifyError: true }]) {
    const h = harness(opts);
    await h.archive.capture([event()]);
    await h.archive.drain(h.t);
    assert.equal([...h.rows.values()][0].properties['保存狀態'].select.name, '重試中');
  }
});

test('source key cannot be rebound to another group', async () => {
  const h = harness();
  await h.archive.capture([event()]);
  const changed = event(); changed.source.groupId = 'another-group';
  await assert.rejects(h.archive.capture([changed]), /group_conflict/);
});

test('all bound binary types include private conversations and recordings; text stays outside archive', async () => {
  const h = harness();
  const privateEvent = event(); privateEvent.source = { userId: 'private-user' };
  assert.equal(isArchiveEvent(event('text')), false);
  for (const e of [event('audio'), event('file', { fileName: 'meeting.m4a' }), privateEvent]) assert.equal(isArchiveEvent(e), true);
  await h.archive.capture([event()], () => true);
  assert.equal(h.rows.size, 0);
});

test('collect relates the archived original to its exact source message and avoids a large preview', async () => {
  const h = harness();
  const e = event();
  collect.init(h.platform);
  await collect.onMessage({ tenant: h.t, binding: { projectPageId: 'synthetic-project', members: { 'synthetic sender': 'test-sender' } }, groupId: 'test-group', senderName: 'synthetic sender', event: e, message: e.message, isMeetingAudio: false,
    notionRequest: (p,o) => h.platform.notionRequest(p,{ ...o,tenantKey:h.t.key }) });
  const row = [...h.rows.values()].find(p => p.properties['保存狀態']);
  const source = h.rows.get(row.properties['訊息'].relation[0].id);
  assert.equal(source.properties['LINE 訊息 ID'].rich_text[0].text.content, e.message.id);
  assert.equal(row.properties['保存狀態'].select.name, '已保存');
  assert.equal(row.properties['專案'].relation[0].id, 'synthetic-project');
  assert.equal(h.calls.some(c => c[0] === 'buffer'), false);
});

test('small PDF originals retain only a Drive link and never upload a Notion preview', async () => {
  const h = harness({ contentLength: 100 });
  h.platform.downloadLineContent = async () => ({ buffer: new Uint8Array(100), contentType: 'application/pdf' });
  const e = event('file', { fileSize: 100 });
  collect.init(h.platform);
  await collect.onMessage({ tenant: h.t, binding: null, groupId: 'test-group', senderName: 'synthetic sender', event: e, message: e.message, isMeetingAudio: false,
    notionRequest: (p,o) => h.platform.notionRequest(p,{ ...o,tenantKey:h.t.key }) });
  const row = [...h.rows.values()].find(p => p.properties['保存狀態']);
  assert.equal(row.properties['保存狀態'].select.name, '已保存');
  assert.ok(row.properties['Drive 連結'].url);
  assert.equal(h.calls.filter(c => c[0] === 'preview').length, 0);
  assert.deepEqual(row.properties['檔案'].files, []);
});

test('direct originals are isolated by tenant and user, with no group task or Notion binary', async () => {
  const h = harness({contentLength:100});
  const e = event('file',{fileSize:100}); e.source = {type:'user',userId:'private-user'};
  await h.archive.capture([e]); await h.archive.drain(h.t);
  const p=[...h.rows.values()][0].properties;
  assert.equal(p['來源類型'].rich_text[0].text.content,'direct');
  assert.ok(h.calls.find(c=>c[0]==='upload')[1].includes('/私人附件/'));
  assert.deepEqual(p['檔案'].files,[]);
  const changed=structuredClone(e); changed.source.userId='different-user';
  await assert.rejects(h.archive.capture([changed]),/group_conflict/);
});

test('private terminal warnings resume independently after a failed push', async()=>{
  const h=harness({lineError:'LINE content download failed: 404 gone',noticeError:true});
  const e=event();e.source={type:'user',userId:'private-user'};
  await h.archive.capture([e]);await h.archive.drain(h.t);
  const p=[...h.rows.values()][0].properties;
  assert.equal(p['保存狀態'].select.name,'需要重傳');
  h.options.noticeError=false;await h.archive.drain(h.t);
  assert.match(p['保存通知'].rich_text[0].text.content,/expired/);
  assert.equal(h.calls.filter(c=>c[0]==='notice').at(-1)[1],'private-user');
});

test('voice messages and audio files archive independently of the meeting feature', async () => {
  for(const type of ['audio','file']) {
    const h=harness({contentLength:100});
    await h.archive.capture([event(type,{fileSize:100,fileName:'recording.m4a'})]); await h.archive.drain(h.t);
    assert.equal([...h.rows.values()][0].properties['保存狀態'].select.name,'已保存');
    assert.equal(h.files.size,1);
  }
});

test('meeting processing reuses the canonical original instead of uploading a second recording', async()=>{
  const h=harness({contentLength:100});const e=event('audio',{fileSize:100,fileName:'recording.m4a'});
  await h.archive.capture([e]);await h.archive.drain(h.t);
  meetings.init(h.platform);
  const link=await meetingTest.archiveAudio(new Uint8Array(100),'recording.m4a','audio/mp4',h.t,{event:e});
  assert.ok(link);assert.equal(h.files.size,1);assert.equal(h.calls.filter(c=>c[0]==='upload').length,1);
});

test('transport-owned binaries retain only the explicitly authorized tenant assignment', async () => {
  const h=harness({contentLength:100}); let resolved=0;
  h.archive.setTransportResolver(async()=>{resolved++;return null;});
  await h.archive.capture([event()],{ownsTransport:()=>true});assert.equal(h.rows.size,0);
  h.archive.setTransportResolver(async()=>({tenant:h.t,binding:{status:'啟用'}}));
  await h.archive.capture([event('file',{fileSize:100})],{ownsTransport:()=>true});await h.archive.drain(h.t);
  assert.equal(h.files.size,1);assert.equal(resolved,1);
});

function legacyRow(h, hasDrive=false) {
  const rich=s=>({rich_text:[{text:{content:s}}]});
  const p={id:'historical-row',parent:{data_source_id:h.t.dataSources.attachments},properties:{
    '檔案名稱':rich('renamed-original.pdf'),'日期':{date:{start:'2026-09-01'}},'檔案大小':{number:100},
    '檔案':{files:[{type:'file',name:'original.pdf',file:{url:'https://prod-files-secure.s3.us-west-2.amazonaws.com/synthetic.pdf'}}]},
    ...(hasDrive?{'Drive 連結':{url:'https://drive.google.com/file/d/synthetic-original-file/view'}}:{}),
  }};h.rows.set(p.id,p);return p;
}
test('historical managed originals migrate without a LINE source and clear Notion only after verification', async () => {
  const h=harness({fetchImpl:async()=>new Response(new Uint8Array(100),{headers:{'content-length':'100'}})});
  const row=legacyRow(h);
  await h.archive.drain(h.t);
  assert.equal(row.properties['保存狀態'].select.name,'已保存');assert.deepEqual(row.properties['檔案'].files,[]);
  assert.equal(h.calls.filter(c=>c[0]==='stream').length,0);
  assert.equal(h.calls.filter(c=>c[0]==='notice').length,0);
  const broken=harness({uploadError:true,fetchImpl:async()=>new Response(new Uint8Array(100),{headers:{'content-length':'100'}})});
  const original=legacyRow(broken);await broken.archive.drain(broken.t);
  assert.equal(original.properties['檔案'].files.length,1);assert.equal(original.properties['保存狀態'].select.name,'重試中');
});
test('historical matching Drive originals are reused after independent Notion checksum and root verification', async () => {
  const md5=crypto.createHash('md5').update(new Uint8Array(100)).digest('hex');
  const h=harness({legacyFile:{id:'synthetic-original-file',size:100,md5Checksum:md5,webViewLink:'https://drive.google.com/file/d/synthetic-original-file/view'},
    fetchImpl:async()=>new Response(new Uint8Array(100),{headers:{'content-length':'100'}})});
  const row=legacyRow(h,true);await h.archive.drain(h.t);
  assert.equal(h.calls.filter(c=>c[0]==='upload').length,0);assert.deepEqual(row.properties['檔案'].files,[]);
  assert.equal(row.properties['保存狀態'].select.name,'已保存');
});
test('private attachment identity uses all active tenant memberships without changing personal assistant access', async()=>{
  const t={...tenant('non-assistant-tenant'),notionConfigured:true,parentPageId:'test-parent',dataSources:{attachments:'a',groupBindings:'g'}};
  const router=createRouter({tenants:[t],logger:quiet,notionRequest:async()=>({results:[{id:'binding',properties:{
    '狀態':{select:{name:'啟用'}},'成員對照':{rich_text:[{text:{content:JSON.stringify({member:'private-user'})}}]},
    'LINE 群組 ID':{rich_text:[{text:{content:'bound-group'}}]},
  }}]})});
  assert.equal((await router.resolveDirectBinding('private-user')).tenant,null);
  assert.equal((await router.resolveDirectAttachmentBinding('private-user')).tenant.key,t.key);
});

test('migration resumes after a final index write applied but its response was lost', async () => {
  const md5=crypto.createHash('md5').update(new Uint8Array(100)).digest('hex');
  const h=harness({failFinalPatch:true,appliedLostPatch:true,
    legacyFile:{id:'synthetic-original-file',size:100,md5Checksum:md5,webViewLink:'https://drive.google.com/file/d/synthetic-original-file/view'},
    fetchImpl:async()=>new Response(new Uint8Array(100),{headers:{'content-length':'100'}})});
  const row=legacyRow(h,true);await h.archive.drain(h.t);
  assert.deepEqual(row.properties['檔案'].files,[]);
  assert.equal(row.properties['保存狀態'].select.name,'重試中');
  h.advance();await h.makeArchive().drain(h.t);
  assert.equal(row.properties['保存狀態'].select.name,'已保存');
  assert.equal(h.calls.filter(c=>c[0]==='upload').length,0);
});

test('legacy Drive root verification rejects moved files, foreign tenant identities and cycles', async()=>{
  const originalFetch=globalThis.fetch;
  let mode='valid';
  globalThis.fetch=async url=>{
    if(String(url).includes('oauth2.googleapis.com'))return Response.json({access_token:'fake',expires_in:3600});
    const id=new URL(String(url)).pathname.split('/').at(-1);
    return Response.json(id==='file' ? {id,size:100,md5Checksum:'checksum',parents:['folder'],appProperties:mode==='foreign'?{amTenant:'other'}:{}} :
      {id,parents:[mode==='valid'?'root':mode==='cycle'?'folder':'outside']});
  };
  try {
    const d=createDrive({clientId:'fake',clientSecret:'fake',refreshToken:'fake',logger:quiet});
    assert.equal((await d.verifyWithinRoot('file','root','owner')).id,'file');
    for(mode of ['foreign','moved','cycle'])await assert.rejects(d.verifyWithinRoot('file','root','owner'));
  } finally {globalThis.fetch=originalFetch;}
});

test('Drive verification checks persisted ownership, parents, size, and retry search scope', async () => {
  const originalFetch = globalThis.fetch;
  const identity = { amTenant: 'hozo-test', amLineMessage: 'message-test' };
  let wrongParent = false, wrongSize = false, wrongTenant = false;
  const seen = [];
  globalThis.fetch = async (url, opts) => {
    seen.push([String(url), opts]);
    if (String(url).includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token:'fake', expires_in:3600 }));
    const f = { id:'saved-file', size:wrongSize?1:100, parents:[wrongParent?'another-root':'target-folder'], appProperties:wrongTenant?{...identity,amTenant:'another-tenant'}:identity };
    return new Response(JSON.stringify(String(url).includes('files?')?{ files:[f] }:f));
  };
  try {
    const drive = createDrive({ clientId:'fake',clientSecret:'fake',refreshToken:'fake',logger:quiet });
    assert.ok((await drive.verifyAttachment('saved-file','target-folder',identity,100)).webViewLink);
    for (const change of ['parent','size','tenant']) {
      wrongParent=change==='parent'; wrongSize=change==='size'; wrongTenant=change==='tenant';
      await assert.rejects(drive.verifyAttachment('saved-file','target-folder',identity,100));
    }
    wrongParent=false; wrongSize=false; wrongTenant=false;
    await assert.rejects(drive.verifyAttachment('saved-file','target-folder',identity,100,'wrong-md5'), /checksum mismatch/);
    await drive.findAttachment('target-folder',identity);
    const q = new URL(seen.at(-1)[0]).searchParams.get('q');
    assert.match(q, /target-folder.*in parents/); assert.match(q,/hozo-test/); assert.match(q,/message-test/);
  } finally { globalThis.fetch = originalFetch; }
});
