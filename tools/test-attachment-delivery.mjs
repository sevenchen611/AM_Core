import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';
import sharp from 'sharp';
import { createAttachmentDelivery } from '../core/attachment-delivery.js';
import {createLine} from '../core/line.js';

const tenant = { key: 'synthetic-tenant', runtimeEnabled: true };
const event = { source: { type: 'group', groupId: 'synthetic-group', userId: 'synthetic-requesting-member' } };
const command = { quotedMessageId: 'synthetic-original', filename: '' };
async function fixture(options = {}) {
  const bytes = options.bytes || await sharp({ create: { width: 1600, height: 1200, channels: 3, background: 'red' } }).png().toBuffer();
  const file = { fileId: 'synthetic-drive-file', filename: '合成測試.png', size: bytes.length,
    md5: crypto.createHash('md5').update(bytes).digest('hex'), url: 'https://drive.google.com/file/d/synthetic-drive-file/view', ...options.file };
  let timestamp = Date.UTC(2026, 9, 8), bound = { tenant, binding: { status: '啟用' } }, original = file;
  const calls = [], logs = [];
  const platform = { publicBaseUrl: 'https://example.test', publicLinkSecret: 'synthetic-key', getDriveAccessToken: async () => 'synthetic-oauth', ...options.platform };
  const delivery = createAttachmentDelivery({ platform, now: () => timestamp, logger: { warn: value => logs.push(value) },
    resolveConversation: async input => { calls.push(['route', input]); return options.requireSender && input.source?.userId !== event.source.userId ? null : bound; },
    resolveOriginal: async (t, input, cmd) => { calls.push(['source', t.key, input, cmd]); if (!original) throw Error('missing'); return original; },
    fetchImpl: async input => {
      const url = new URL(input); calls.push(['drive']);
      if (url.searchParams.get('alt') === 'media') return new Response(bytes);
      return Response.json({ id: file.fileId, size: file.size, md5Checksum: file.md5,
        mimeType: 'image/png', trashed: false, ...options.metadata });
    },
  });
  return { delivery, platform, calls, logs, bytes, file, expire: () => { timestamp += 7201000; },
    revoke: () => { bound = { tenant, binding: { status: '停用' } }; }, change: () => { original = { ...file, md5: 'b'.repeat(32) }; },
    remove: () => { original = null; } };
}
async function download(f, url, selectedTenant = tenant) {
  const server = http.createServer((req, res) => f.delivery.handleDownload(req, res, { tenant: selectedTenant, url: new URL(url) }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { const r = await fetch(`http://127.0.0.1:${server.address().port}`); return { status: r.status, headers: r.headers, bytes: Buffer.from(await r.arrayBuffer()) }; }
  finally { await new Promise(resolve => server.close(resolve)); }
}
test('photo delivery returns exact original, bounded JPEG preview and attachment download', async () => {
  const f = await fixture(), messages = await f.delivery.messages(tenant, event, command, f.file);
  assert.equal(messages.length, 2); assert.equal(messages[1].type, 'image');
  const original = await download(f, messages[1].originalContentUrl);
  assert.equal(original.status, 200); assert.deepEqual(original.bytes, f.bytes);
  const preview = await download(f, messages[1].previewImageUrl);
  assert.equal(preview.headers.get('content-type'), 'image/jpeg');
  assert.ok(preview.bytes.length <= 1024 * 1024); assert.ok((await sharp(preview.bytes).metadata()).width <= 1024);
  const attachment = await download(f, messages[0].text.split('\n').at(-1));
  assert.equal(attachment.status, 200); assert.deepEqual(attachment.bytes, f.bytes);
  assert.match(attachment.headers.get('content-disposition'), /^attachment;/);
  assert.equal(attachment.headers.get('cache-control'), 'private, no-store');
});
test('files, HEIC and photos above LINE limit retain original download only', async () => {
  for (const options of [{ metadata: { mimeType: 'application/pdf' } }, { metadata: { mimeType: 'image/heic' } }, { file: { size: 11 * 1024 * 1024 } }]) {
    const f = await fixture(options), result = await f.delivery.messages(tenant, event, command, f.file);
    assert.equal(result.length, 1); assert.match(result[0].text, /token=/);
  }
});
test('expired and tampered tokens cannot perform source or Drive requests', async () => {
  for (const change of ['expiry', 'signature']) {
    const f = await fixture(), messages = await f.delivery.messages(tenant, event, command, f.file);
    const url = new URL(messages[1].originalContentUrl), before = f.calls.length;
    if (change === 'expiry') f.expire(); else url.searchParams.set('token', url.searchParams.get('token') + 'x');
    assert.equal((await download(f, url.href)).status, 403); assert.equal(f.calls.length, before);
  }
});
test('shared signing key cannot switch tenant; revoked bindings and changed originals are denied', async () => {
  for (const action of ['tenant', 'binding', 'changed']) {
    const f = await fixture(), messages = await f.delivery.messages(tenant, event, command, f.file);
    if (action === 'binding') f.revoke(); if (action === 'changed') f.change();
    const before = f.calls.filter(c => c[0] === 'drive').length;
    assert.equal((await download(f, messages[1].originalContentUrl, action === 'tenant' ? { ...tenant, key: 'foreign' } : tenant)).status, 403);
    assert.equal(f.calls.filter(c => c[0] === 'drive').length, before);
    assert.ok(f.logs.every(value => !value.includes('token=') && !value.includes('synthetic-oauth')));
  }
});
test('deleted or unavailable source cannot expose bytes through an issued link', async () => {
  const f = await fixture(), messages = await f.delivery.messages(tenant, event, command, f.file);
  f.remove(); assert.equal((await download(f, messages[1].originalContentUrl)).status, 503);
});
test('private link reuses the original sender scope and explicit filename command', async () => {
  const f = await fixture(), privateEvent = { source: { type: 'user', userId: 'synthetic-private-sender' } };
  const cmd = { filename: '合成測試.png', quotedMessageId: '' };
  const messages = await f.delivery.messages(tenant, privateEvent, cmd, f.file);
  assert.equal((await download(f, messages[1].originalContentUrl)).status, 200);
  const source = f.calls.find(c => c[0] === 'source');
  assert.deepEqual(source[2].source, privateEvent.source); assert.deepEqual(source[3], cmd);
});

test('transport-owned group downloads preserve the requesting member for sender authorization', async () => {
  const f = await fixture({ requireSender: true }), messages = await f.delivery.messages(tenant, event, command, f.file);
  assert.equal((await download(f, messages[1].originalContentUrl)).status, 200);
  assert.deepEqual(f.calls.find(c => c[0] === 'source')[2].source, event.source);
});
test('unconfigured signing keeps existing verified Google link; changed image metadata never yields image', async () => {
  const legacy = await fixture({ platform: { publicLinkSecret: '' } });
  assert.match((await legacy.delivery.messages(tenant, event, command, legacy.file))[0].text, /drive.google.com/);
  const changed = await fixture({ metadata: { md5Checksum: 'b'.repeat(32) } });
  assert.equal((await changed.delivery.messages(tenant, event, command, changed.file)).length, 1);
});
test('extensionless archived MP4 downloads with compatible filenames and exact unchanged bytes',async()=>{
  const bytes=Buffer.from('0000001c667479706d7034320000000169736f6d6d7034316d7034320000000c6d64617401020304','hex');
  const f=await fixture({bytes,file:{filename:'file-synthetic-original'},metadata:{mimeType:'video/mp4'}});
  const messages=await f.delivery.messages(tenant,event,command,f.file);
  assert.equal(messages.length,1);assert.match(messages[0].text,/file-synthetic-original\.mp4/);
  const result=await download(f,messages[0].text.split('\n').at(-1));
  assert.equal(result.status,200);assert.equal(result.headers.get('content-type'),'video/mp4');
  assert.match(result.headers.get('content-disposition'),/filename="attachment\.mp4";/);
  assert.match(result.headers.get('content-disposition'),/filename\*=UTF-8''file-synthetic-original\.mp4$/);
  assert.deepEqual(result.bytes,bytes);assert.equal(result.bytes.subarray(4,8).toString(),'ftyp');
});
test('MIME naming covers recovered audio and PDF without rewriting supplied extensions or guessing unknown files',async()=>{
  for(const [mime,name,suffix] of [['audio/mp4','audio-original','.m4a'],['application/pdf','file-original','.pdf'],
    ['video/mp4','original.MOV','.MOV'],['application/octet-stream','unknown-original','unknown-original']]){
    const f=await fixture({file:{filename:name},metadata:{mimeType:mime}});
    const messages=await f.delivery.messages(tenant,event,command,f.file),result=await download(f,messages[0].text.split('\n').at(-1));
    assert.equal(result.status,200);assert.ok(result.headers.get('content-disposition').endsWith(suffix));
    assert.deepEqual(result.bytes,f.bytes);
  }
});
test('download metadata mismatches fail before headers or bytes can masquerade as a video',async()=>{
  const f=await fixture({file:{filename:'file-original'},metadata:{mimeType:'video/mp4',md5Checksum:'b'.repeat(32)}});
  const messages=await f.delivery.messages(tenant,event,command,f.file),result=await download(f,messages[0].text.split('\n').at(-1));
  assert.equal(result.status,503);assert.equal(result.headers.get('content-disposition'),null);
  assert.ok(!result.bytes.equals(f.bytes));
});
test('new LINE media names gain the MIME extension; original explicit filenames remain preserved',()=>{
  const line=createLine({});
  assert.equal(line.resolveLineFilename({},'video','synthetic','Video/MP4; charset=binary'),'video-synthetic.mp4');
  assert.equal(line.resolveLineFilename({},'file','synthetic','video/mp4'),'file-synthetic.mp4');
  assert.equal(line.resolveLineFilename({},'audio','synthetic','audio/mp4'),'audio-synthetic.m4a');
  assert.equal(line.resolveLineFilename({fileName:'original.mov'},'video','synthetic','video/mp4'),'original.mov');
  assert.equal(line.resolveLineFilename({},'file','synthetic','application/octet-stream'),'file-synthetic');
});
