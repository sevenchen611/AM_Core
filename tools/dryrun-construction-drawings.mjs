import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { listDesignDrawings, uploadDesignDrawing, __test } from '../modules/construction/drawings.js';

const calls = [];
const folderIds = new Map();
const deps = {
  actor: '設計師王小姐',
  driveConfigured: true,
  driveRootFolderId: 'drive-root',
  dataSources: { designDrawings: 'drawings-ds' },
  ensureDriveFolder: async (name, parent) => {
    calls.push(['folder', name, parent]);
    const id = `folder-${folderIds.size + 1}`;
    folderIds.set(`${parent}/${name}`, id);
    return id;
  },
  uploadDriveStream: async (stream, filename, contentType, parent, size) => {
    let bytes = 0;
    for await (const chunk of stream) bytes += chunk.length;
    calls.push(['upload', filename, contentType, parent, size, bytes]);
    return { id: 'drive-file-v2', webViewLink: 'https://drive.google.com/file/d/drive-file-v2/view' };
  },
  notionRequest: async (pathname, options = {}) => {
    calls.push(['notion', pathname, options]);
    if (pathname === '/v1/pages/project-1') return {
      properties: { '專案名稱': { type: 'title', title: [{ plain_text: '葉小蝸工程表板' }] } },
    };
    if (pathname === '/v1/pages' && options.method === 'POST') return { id: 'drawing-page-v2' };
    if (pathname.endsWith('/query')) return { results: [
      { id: 'v1', created_time: '2026-09-13T09:00:00Z', properties: {
        '圖面': { title: [{ plain_text: '全區平面圖' }] }, '版本': { rich_text: [{ plain_text: 'V1' }] },
        '狀態': { select: { name: '草稿' } }, 'Drive 連結': { url: 'https://drive/v1' },
        '上傳時間': { date: { start: '2026-09-13T09:00:00Z' } },
      } },
      { id: 'v2', created_time: '2026-09-14T09:00:00Z', properties: {
        '圖面': { title: [{ plain_text: '全區平面圖' }] }, '版本': { rich_text: [{ plain_text: 'V2' }] },
        '狀態': { select: { name: '定版' } }, 'Drive 連結': { url: 'https://drive/v2' },
        '上傳時間': { date: { start: '2026-09-14T09:00:00Z' } },
      } },
    ] };
    throw new Error(`Unexpected Notion call ${pathname}`);
  },
};

const uploaded = await uploadDesignDrawing(deps, {
  projectId: 'project-1', drawingName: '全區平面圖', version: 'V2', status: '定版',
  filename: '平面圖:定版?.dwg', contentType: 'application/acad', size: 4,
  note: '修正門向', stream: Readable.from([Buffer.from('plan')]),
});
assert.equal(uploaded.ok, true);
assert.equal(uploaded.drawing.driveFileId, 'drive-file-v2');
assert.deepEqual(calls.filter((call) => call[0] === 'folder').map((call) => call.slice(1)), [
  ['設計圖', 'drive-root'], ['葉小蝸工程表板', 'folder-1'], ['全區平面圖', 'folder-2'],
]);
const upload = calls.find((call) => call[0] === 'upload');
assert.match(upload[1], /_V2_平面圖_定版_\.dwg$/);
assert.equal(upload[5], 4);
const create = calls.find((call) => call[0] === 'notion' && call[1] === '/v1/pages');
assert.equal(create[2].body.parent.data_source_id, 'drawings-ds');
assert.equal(create[2].body.properties['Drive 檔案 ID'].rich_text[0].text.content, 'drive-file-v2');

const listed = await listDesignDrawings(deps, 'project-1');
assert.equal(listed.groups.length, 1);
assert.equal(listed.groups[0].versionCount, 2);
assert.equal(listed.groups[0].latest.version, 'V2');
assert.equal((await listDesignDrawings({ ...deps, dataSources: {} }, 'project-1')).configured, false);
assert.equal(__test.safeSegment('A/B:*?圖'), 'A_B___圖');
await assert.rejects(() => uploadDesignDrawing(deps, {
  projectId: 'project-1', drawingName: '圖', version: 'V3', filename: 'x.dwg', size: __test.MAX_DRAWING_BYTES + 1,
  stream: Readable.from([]),
}), /500 MB/);

console.log('construction design drawings dry run: 12 assertions passed');
