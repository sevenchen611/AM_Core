import { Readable } from 'node:stream';
import { assertManagedProject } from './master-data.js';
import { textFrag } from './common.js';
import { __test } from './journal.js';

const MAX_BYTES = 20 * 1024 * 1024;
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
function imageType(b) {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return '';
}
export async function uploadJournalPhoto(deps, scope, input) {
  if (!deps.dataSources.constructionPhotos || !deps.driveConfigured || !deps.driveRootFolderId || !deps.uploadDriveStream) throw fail('現場照片儲存尚未設定', 503);
  if (!deps.actor) throw fail('請先登入', 401);
  const project = await assertManagedProject(deps, scope, input.projectId);
  const date = __test.dateOnly(input.date);
  const filename = String(input.filename || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180);
  if (!filename) throw fail('請提供檔名');
  const parts = []; let size = 0;
  for await (const c of input.stream) { size += c.length; if (size > MAX_BYTES) throw fail('照片單張上限 20 MB', 413); parts.push(c); }
  const bytes = Buffer.concat(parts), contentType = imageType(bytes);
  if (!contentType || contentType !== input.contentType) throw fail('請上傳 JPEG、PNG 或 WebP 照片');
  const root = await deps.ensureDriveFolder('工程日誌', deps.driveRootFolderId);
  // Stable project ID avoids collisions when cases share a display name.
  const projectFolder = await deps.ensureDriveFolder(project.id, root);
  const day = await deps.ensureDriveFolder(date, projectFolder);
  const stored = await deps.uploadDriveStream(Readable.from([bytes]), `${Date.now()}_${filename}`, contentType, day, size);
  const url = stored.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(stored.id)}/view`;
  const caption = String(input.caption || '').slice(0, 1000);
  const p = await deps.notionRequest('/v1/pages', { method: 'POST', body: {
    parent: { type: 'data_source_id', data_source_id: deps.dataSources.constructionPhotos },
    properties: { '照片': { title: textFrag(filename) }, '專案': { relation: [{ id: project.id }] },
      '施工日期': { date: { start: date } }, 'Drive 連結': { url }, 'Drive 檔案 ID': { rich_text: textFrag(stored.id) },
      '說明': { rich_text: textFrag(caption) }, '上傳者': { rich_text: textFrag(deps.actor) }, '檔案大小': { number: size } },
  } });
  return { id: p.id, kind: 'photo', name: filename, url, caption };
}
export const __photoTest = { imageType, MAX_BYTES };
