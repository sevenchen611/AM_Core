import crypto from 'node:crypto';
import { pageName } from './common.js';
import { listDesignDrawings } from './drawings.js';
import { createContractManagementService } from './contract-management.js';
import { CONTRACT_FILE_MAX_BYTES } from './contract-files.js';
import { ContractSigningError } from './contract-signing.js';

const MIME_BY_EXTENSION = Object.freeze({
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  dwg: 'application/acad',
});
const SUPPORTED_MIME_TYPES = new Set(Object.values(MIME_BY_EXTENSION));
const SOURCE = 'engineering_phase_1_drawing_library';
const SOURCE_STAGE = 'phase_1_drawing_review_and_finalization';
const text = (value) => String(value ?? '').trim();
const hash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const fail = (code, message, statusCode = 400) => Object.assign(
  new ContractSigningError(code, message, statusCode), { statusCode },
);

function packageOf(version) {
  return version?.documentPackage || version?.snapshot?.documentPackage
    || version?.contractSnapshot?.documentPackage || version?.contract_snapshot?.documentPackage || {};
}

function mimeFor(drawing) {
  const declared = text(drawing?.contentType).split(';')[0].toLowerCase();
  if (SUPPORTED_MIME_TYPES.has(declared)) return declared;
  return MIME_BY_EXTENSION[text(drawing?.originalFilename).split('.').pop().toLowerCase()] || '';
}

function documents(version) {
  const pkg = packageOf(version);
  return [pkg.contractBody, ...(pkg.constructionDrawings || []), pkg.quotation, ...(pkg.attachments || [])].filter(Boolean);
}

export function createContractProjectDrawingService(deps) {
  const management = createContractManagementService({ store: deps.contractStore });

  async function candidates(context, input) {
    if (!deps.tenant?.key || context?.tenant?.key !== deps.tenant.key) {
      throw fail('PROJECT_DRAWING_TENANT_MISMATCH', '工程圖庫的租戶授權不一致。', 403);
    }
    // Contract management performs the authoritative tenant/project scope check
    // before the drawing index or Drive is touched.
    const detail = await management.getContractDetail(context, { contractId: input.contractId });
    const projectId = text(detail.contract.projectId || detail.contract.project_id);
    if (!projectId) throw fail('PROJECT_DRAWING_PROJECT_REQUIRED', '合約尚未綁定工程專案。', 409);
    if (!deps.dataSources?.designDrawings || !deps.notionRequest) {
      throw fail('PROJECT_DRAWING_STORE_UNAVAILABLE', '工程階段一圖庫尚未設定。', 503);
    }
    const library = await listDesignDrawings(deps, projectId);
    if (!library.configured) throw fail('PROJECT_DRAWING_STORE_UNAVAILABLE', '工程階段一圖庫尚未設定。', 503);
    const includedFileIds = new Set(documents(detail.latestVersion).map((item) => text(item.fileId || item.file_id)).filter(Boolean));
    const includedVersionIds = new Set(documents(detail.latestVersion)
      .map((item) => text(item.sourceEvidence?.drawingVersionId)).filter(Boolean));
    const projectLabel = await pageName(deps, projectId).catch(() => text(detail.contract.projectCode) || projectId);
    const rows = library.versions.map((drawing) => {
      const mimeType = mimeFor(drawing);
      const sizeBytes = Number(drawing.size || 0);
      const fileId = text(drawing.driveFileId);
      const reason = drawing.status === '作廢' ? '此圖面版本已作廢'
        : !fileId ? '圖庫索引缺少原始檔'
          : !mimeType ? '合約附件僅支援 PDF、PNG、JPEG、DOCX、XLSX 或 DWG'
            : !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 ? '圖庫索引缺少有效檔案大小'
              : sizeBytes > CONTRACT_FILE_MAX_BYTES ? '檔案超過合約附件 25 MB 上限' : '';
      return {
        id: drawing.id,
        drawingName: drawing.name,
        version: drawing.version,
        status: drawing.status,
        name: drawing.originalFilename || drawing.name,
        mimeType,
        sizeBytes,
        uploadedAt: drawing.uploadedAt,
        uploader: drawing.uploader,
        note: drawing.note,
        available: !reason,
        reason,
        included: includedVersionIds.has(drawing.id) || includedFileIds.has(fileId),
        fileId,
        projectId,
        projectCode: text(detail.contract.projectCode || detail.contract.project_code),
        projectName: projectLabel,
      };
    });
    return { detail, rows };
  }

  async function download(item) {
    if (!item.available) throw fail('PROJECT_DRAWING_UNAVAILABLE', item.reason, 409);
    if (typeof deps.auditDrivePrivate !== 'function' || typeof deps.downloadFromDrive !== 'function') {
      throw fail('PROJECT_DRAWING_DRIVE_UNAVAILABLE', '工程圖庫私有檔案讀取尚未設定。', 503);
    }
    if ((await deps.auditDrivePrivate(item.fileId))?.private !== true) {
      throw fail('PROJECT_DRAWING_NOT_PRIVATE', '工程圖檔不是私有保存，禁止納入合約。', 409);
    }
    const result = await deps.downloadFromDrive(item.fileId, CONTRACT_FILE_MAX_BYTES);
    const buffer = Buffer.isBuffer(result) ? result : result?.buffer;
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > CONTRACT_FILE_MAX_BYTES) {
      throw fail('PROJECT_DRAWING_SIZE_INVALID', '工程圖檔大小不合法或超過 25 MB。', 413);
    }
    return { buffer, fileName: item.name, mimeType: item.mimeType, sha256: hash(buffer) };
  }

  async function listCandidates(context, input) {
    const { rows } = await candidates(context, input);
    // Storage ids and direct Drive links never cross the browser boundary.
    return rows.map(({ fileId, projectId, ...item }) => item);
  }

  async function loadCandidate(context, input) {
    const { rows } = await candidates(context, input);
    const item = rows.find((row) => row.id === text(input.drawingId));
    if (!item) throw fail('PROJECT_DRAWING_NOT_FOUND', '圖面版本不屬於這份合約的工程專案。', 404);
    return download(item);
  }

  async function resolveSelections(context, input) {
    const selections = input.selections;
    if (!Array.isArray(selections) || selections.length > 30) {
      throw fail('PROJECT_DRAWING_SELECTION_INVALID', '工程圖庫一次最多選擇 30 份圖面。');
    }
    if (!selections.length) return { documentPackage: structuredClone(input.documentPackage || {}), evidence: [] };
    const { rows, detail } = await candidates(context, input);
    const sourceVersionId = text(input.sourceVersionId);
    if (sourceVersionId && detail.latestVersion?.id !== sourceVersionId) {
      throw fail('PROJECT_DRAWING_STALE_CONTRACT_VERSION', '合約已建立較新的版本，請重新開啟後再選取工程圖。', 409);
    }
    const pkg = structuredClone(input.documentPackage || {});
    pkg.constructionDrawings = Array.isArray(pkg.constructionDrawings) ? pkg.constructionDrawings : [];
    const selected = new Set();
    const existingVersionIds = new Set(pkg.constructionDrawings.map((item) => text(item.sourceEvidence?.drawingVersionId)).filter(Boolean));
    const existingFileIds = new Set(pkg.constructionDrawings.map((item) => text(item.fileId || item.file_id)).filter(Boolean));
    const evidence = [];
    for (const raw of selections) {
      const id = typeof raw === 'string' ? text(raw) : text(raw?.id);
      if (!id || selected.has(id)) continue;
      selected.add(id);
      const item = rows.find((row) => row.id === id);
      if (!item) throw fail('PROJECT_DRAWING_NOT_FOUND', '圖面版本不屬於這份合約的工程專案。', 404);
      if (!item.available) throw fail('PROJECT_DRAWING_UNAVAILABLE', `${item.name}：${item.reason}`, 409);
      if (existingVersionIds.has(item.id) || existingFileIds.has(item.fileId)) continue;
      const loaded = await download(item);
      const sourceEvidence = {
        source: SOURCE,
        sourceProjectId: item.projectId,
        sourceProjectCode: item.projectCode,
        sourceProjectName: item.projectName,
        sourceStage: SOURCE_STAGE,
        sourceStageLabel: '階段一：審圖與圖面定版',
        drawingVersionId: item.id,
        drawingName: item.drawingName,
        drawingVersion: item.version,
        drawingStatus: item.status,
        originalFileName: item.name,
        sourceUploadedAt: item.uploadedAt,
        sourceUploader: item.uploader,
        referencedAt: new Date().toISOString(),
        referencedBy: text(context.actor),
        snapshot: {
          name: item.name,
          mimeType: loaded.mimeType,
          sizeBytes: loaded.buffer.length,
          sha256: loaded.sha256,
        },
      };
      pkg.constructionDrawings.push({
        category: 'construction_drawing',
        fileId: item.fileId,
        name: item.name,
        revision: item.version,
        mimeType: loaded.mimeType,
        sizeBytes: loaded.buffer.length,
        sha256: loaded.sha256,
        required: true,
        sourceEvidence,
      });
      evidence.push(sourceEvidence);
    }
    return { documentPackage: pkg, evidence };
  }

  return Object.freeze({ listCandidates, loadCandidate, resolveSelections });
}

export const __test = { mimeFor, SOURCE, SOURCE_STAGE };
