// 工程設計圖版本庫：檔案本體只存 Google Drive，Notion 僅保存可稽核的版本索引。
// Drive 路徑：<tenant root>/設計圖/<project>/<drawing name>/<timestamp>_<version>_<original filename>

import { plain, pageName, queryAll, sameId } from './common.js';

const MAX_DRAWING_BYTES = 500 * 1024 * 1024;
const ALLOWED_STATUSES = new Set(['草稿', '送審', '定版', '發包版', '變更版', '作廢']);

function inputError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function requiredText(value, label, maxLength) {
  const text = String(value || '').trim();
  if (!text) throw inputError(`${label} required`);
  return text.slice(0, maxLength);
}

function safeSegment(value, fallback = '未命名') {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return (cleaned || fallback).slice(0, 120);
}

function richText(value) {
  const content = String(value || '').slice(0, 1900);
  return content ? [{ type: 'text', text: { content } }] : [];
}

function propText(property) {
  return plain(property?.rich_text || property?.title);
}

function parseDrawing(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    name: propText(p['圖面']),
    version: propText(p['版本']),
    status: p['狀態']?.select?.name || '',
    originalFilename: propText(p['原始檔名']),
    driveFileId: propText(p['Drive 檔案 ID']),
    driveUrl: p['Drive 連結']?.url || '',
    contentType: propText(p['檔案類型']),
    size: Number(p['檔案大小']?.number || 0),
    note: propText(p['版本說明']),
    uploader: propText(p['上傳者']),
    uploadedAt: p['上傳時間']?.date?.start || page.created_time || '',
  };
}

export async function listDesignDrawings(deps, projectId) {
  if (!projectId) throw inputError('project required');
  const dataSourceId = deps.dataSources.designDrawings;
  if (!dataSourceId) return { configured: false, versions: [], groups: [] };

  const pages = await queryAll(deps, dataSourceId, {
    property: '專案', relation: { contains: projectId },
  });
  // Keep a local relation check in addition to the Notion filter so a stale or
  // overly broad upstream response can never leak another project's drawings.
  const versions = pages.filter((page) => !page.archived && !page.in_trash
    && (page.properties?.['專案']?.relation || [])
      .some((relation) => sameId(relation.id, projectId))).map(parseDrawing)
    .sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
  const grouped = new Map();
  for (const version of versions) {
    if (!grouped.has(version.name)) grouped.set(version.name, []);
    grouped.get(version.name).push(version);
  }
  const groups = [...grouped.entries()].map(([name, items]) => ({
    name,
    latest: items[0],
    versionCount: items.length,
    versions: items,
  }));
  return { configured: true, versions, groups };
}

export async function uploadDesignDrawing(deps, input) {
  const projectId = requiredText(input.projectId, 'project', 100);
  const drawingName = requiredText(input.drawingName, 'drawingName', 150);
  const version = requiredText(input.version, 'version', 80);
  const originalFilename = requiredText(input.filename, 'filename', 240);
  const status = String(input.status || '草稿').trim();
  const note = String(input.note || '').trim().slice(0, 1900);
  const uploader = String(input.uploader || deps.actor || '網頁').trim().slice(0, 200);
  const size = Number(input.size);
  const contentType = String(input.contentType || 'application/octet-stream').slice(0, 200);

  if (!ALLOWED_STATUSES.has(status)) throw inputError('invalid drawing status');
  if (!Number.isFinite(size) || size <= 0) throw inputError('檔案大小無效');
  if (size > MAX_DRAWING_BYTES) throw inputError('設計圖單檔上限為 500 MB', 413);
  if (!deps.driveConfigured || !deps.driveRootFolderId || !deps.uploadDriveStream) {
    throw inputError('Google Drive 尚未設定，不能上傳設計圖', 503);
  }
  const dataSourceId = deps.dataSources.designDrawings;
  if (!dataSourceId) throw inputError('設計圖版本資料庫尚未設定', 503);

  const projectName = safeSegment(await pageName(deps, projectId), '未命名專案');
  const drawingFolderName = safeSegment(drawingName);
  const root = await deps.ensureDriveFolder('設計圖', deps.driveRootFolderId);
  const projectFolder = await deps.ensureDriveFolder(projectName, root);
  const drawingFolder = await deps.ensureDriveFolder(drawingFolderName, projectFolder);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const storedFilename = `${timestamp}_${safeSegment(version, '版本')}_${safeSegment(originalFilename, 'drawing')}`;
  const driveFile = await deps.uploadDriveStream(input.stream, storedFilename, contentType, drawingFolder, size);
  if (!driveFile?.id || !driveFile?.webViewLink) throw new Error('Google Drive 上傳完成，但未回傳檔案識別或連結');

  const uploadedAt = new Date().toISOString();
  const created = await deps.notionRequest('/v1/pages', {
    method: 'POST',
    body: {
      parent: { type: 'data_source_id', data_source_id: dataSourceId },
      properties: {
        '圖面': { title: richText(drawingName) },
        '專案': { relation: [{ id: projectId }] },
        '版本': { rich_text: richText(version) },
        '狀態': { select: { name: status } },
        '原始檔名': { rich_text: richText(originalFilename) },
        'Drive 檔案 ID': { rich_text: richText(driveFile.id) },
        'Drive 連結': { url: driveFile.webViewLink },
        '檔案類型': { rich_text: richText(contentType) },
        '檔案大小': { number: size },
        '版本說明': { rich_text: richText(note) },
        '上傳者': { rich_text: richText(uploader) },
        '上傳時間': { date: { start: uploadedAt } },
      },
    },
  });
  return {
    ok: true,
    drawing: {
      id: created.id,
      name: drawingName,
      version,
      status,
      originalFilename,
      driveFileId: driveFile.id,
      driveUrl: driveFile.webViewLink,
      contentType,
      size,
      note,
      uploader,
      uploadedAt,
    },
  };
}

export const __test = { MAX_DRAWING_BYTES, safeSegment, parseDrawing };
