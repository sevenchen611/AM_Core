import assert from 'node:assert/strict';
import collect, { __test } from '../modules/collect/index.js';

function tenant(overrides = {}) {
  return {
    key: 'engineering', driveConfigured: true, driveRootFolderId: 'engineering-drive-root',
    dataSources: { attachments: 'engineering-attachments' },
    config: { attachments: { archiveAllLineGroupAttachmentsToDrive: true } },
    ...overrides,
  };
}

function context(message, overrides = {}) {
  return {
    tenant: tenant(), binding: { projectPageId: 'engineering-project' },
    groupId: 'engineering-line-group', message,
    event: { timestamp: Date.UTC(2026, 7, 12, 4, 0, 0) }, senderName: 'tester', ...overrides,
  };
}

function harness() {
  const calls = [];
  const createdPages = [];
  collect.init({
    ensureDriveFolder: async (name, parent) => { calls.push(['folder', name, parent]); return `${parent}/${name}`; },
    streamLineContent: async (messageId) => {
      calls.push(['stream-line', messageId]);
      return { stream: { kind: 'line-stream' }, contentType: 'application/octet-stream', contentLength: 12345 };
    },
    uploadDriveStream: async (stream, filename, contentType, parentId, size) => {
      calls.push(['drive-stream', filename, contentType, parentId, size, stream.kind]);
      return { id: 'drive-stream-id', webViewLink: 'https://drive.example/stream' };
    },
    downloadLineContent: async (messageId) => {
      calls.push(['download-line', messageId]);
      return { buffer: Buffer.from('%PDF-test'), contentType: 'application/pdf' };
    },
    resolveLineFilename: (message, messageType, messageId) => message.fileName || `${messageType}-${messageId}`,
    uploadFileToNotion: async (_buffer, filename, contentType) => {
      calls.push(['notion-upload', filename, contentType]); return { id: 'notion-upload-id' };
    },
    uploadToDrive: async (_buffer, filename, contentType, parentId) => {
      calls.push(['drive-buffer', filename, contentType, parentId]);
      return { id: 'drive-buffer-id', webViewLink: 'https://drive.example/buffer' };
    },
    notionRequest: async (pathname, options) => {
      calls.push(['notion-request', pathname]); createdPages.push(options.body); return { id: 'attachment-page-id' };
    },
  });
  return { calls, createdPages };
}

assert.equal(__test.archiveAllGroupAttachments(tenant(), 'group-id'), true);
assert.equal(__test.archiveAllGroupAttachments(tenant(), ''), false);
assert.equal(__test.notionUploadCandidate('drawing.dwg', 100), false);
assert.equal(__test.notionUploadCandidate('drawing.pdf', 100), true);
assert.equal(__test.notionUploadCandidate('large.pdf', 21 * 1024 * 1024), false);
assert.equal(__test.storedMessageContent({ type: 'sticker', packageId: 'p', stickerId: 's' }), '[sticker] package:p sticker:s');

{
  const { calls, createdPages } = harness();
  await __test.storeAttachment({
    ctx: context({ id: 'dwg-message', type: 'file', fileName: '明義街套房cad20260812.dwg', fileSize: 12345 }),
    messagePage: { id: 'message-page' }, messageId: 'dwg-message', messageType: '檔案',
    eventTime: '2026-08-12T04:00:00.000Z',
  });
  assert.ok(calls.some((c) => c[0] === 'drive-stream' && c[1].endsWith('.dwg')));
  assert.ok(!calls.some((c) => c[0] === 'notion-upload'));
  assert.ok(!calls.some((c) => c[0] === 'download-line'));
  assert.equal(createdPages[0].properties['Drive 連結'].url, 'https://drive.example/stream');
  assert.equal(createdPages[0].properties['檔案'], undefined);
  assert.equal(createdPages[0].properties['檔案大小'].number, 12345);
}

{
  const { calls, createdPages } = harness();
  await __test.storeAttachment({
    ctx: context({ id: 'pdf-message', type: 'file', fileName: 'drawing.pdf', fileSize: 9 }),
    messagePage: { id: 'message-page' }, messageId: 'pdf-message', messageType: '檔案',
    eventTime: '2026-08-12T04:00:00.000Z',
  });
  assert.ok(calls.some((c) => c[0] === 'download-line'));
  assert.ok(calls.some((c) => c[0] === 'notion-upload'));
  assert.ok(calls.some((c) => c[0] === 'drive-buffer'));
  assert.equal(createdPages[0].properties['Drive 連結'].url, 'https://drive.example/buffer');
  assert.equal(createdPages[0].properties['檔案'].files[0].file_upload.id, 'notion-upload-id');
}

{
  const { calls, createdPages } = harness();
  await __test.storeAttachment({
    ctx: context({ id: 'video-message', type: 'video' }), messagePage: { id: 'message-page' },
    messageId: 'video-message', messageType: '影片', eventTime: '2026-08-12T04:00:00.000Z',
  });
  assert.ok(calls.some((c) => c[0] === 'drive-stream' && c[1] === 'video-video-message.mp4'));
  assert.equal(createdPages[0].properties['檔案名稱'].rich_text[0].text.content, 'video-video-message.mp4');
}

console.log('collect attachment archive dry run passed');
