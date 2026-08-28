import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import PDFDocument from 'pdfkit';

export const ENGINEERING_CONTRACT_PDF_RENDER_PATH = '/internal/v1/engineering-contracts/render';

const MAX_BODY_BYTES = 6 * 1024 * 1024;
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 200;
const CACHE_TTL_MS = 15 * 60 * 1000;
const KINDS = new Set(['issued_pdf', 'signed_pdf']);
const PAGE = Object.freeze({ size: 'A4', margin: 48, width: 595.28, height: 841.89 });
const FONT_CSS = fileURLToPath(new URL('../../node_modules/@fontsource-variable/noto-sans-tc/index.css', import.meta.url));
// PDFKit/fontkit can read the Fontsource variable WOFF2 files, but its PDF
// subset embedding leaves variable outlines unusable in strict PDF renderers.
// These checked-in 400-weight TTF subsets are deterministically instantiated
// from the installed Fontsource files and retain the package's Unicode ranges.
const FONT_ROOT = fileURLToPath(new URL('./assets/noto-sans-tc-400/', import.meta.url));

function rendererError(code, message, statusCode = 400, details = {}) {
  return Object.assign(new Error(message), { code, statusCode, details });
}

function clean(value) {
  return String(value ?? '').trim();
}

function first(value, fields, fallback = '') {
  for (const field of fields) {
    if (value && Object.prototype.hasOwnProperty.call(value, field) && value[field] !== undefined) return value[field];
  }
  return fallback;
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseRange(value) {
  return value.split(',').map((part) => {
    const [start, end = start] = part.trim().replace(/^U\+/i, '').split('-');
    return [Number.parseInt(start, 16), Number.parseInt(end, 16)];
  }).filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end));
}

function loadFontSubsets() {
  const css = fs.readFileSync(FONT_CSS, 'utf8');
  const subsets = [];
  const pattern = /src:\s*url\(\.\/files\/([^)]*\.woff2)\)[\s\S]*?unicode-range:\s*([^;]+);/g;
  for (const match of css.matchAll(pattern)) {
    subsets.push(Object.freeze({
      name: `noto-tc-${subsets.length}`,
      path: `${FONT_ROOT}${match[1].replace('-wght-normal.woff2', '-400.ttf')}`,
      ranges: parseRange(match[2]),
    }));
  }
  if (subsets.length < 100) throw new Error('Noto Sans TC complete subset index is unavailable.');
  return Object.freeze(subsets);
}

const FONT_SUBSETS = loadFontSubsets();
const FONT_BY_CODEPOINT = new Map();

function subsetFor(character) {
  const codePoint = character.codePointAt(0);
  if (FONT_BY_CODEPOINT.has(codePoint)) return FONT_BY_CODEPOINT.get(codePoint);
  const subset = FONT_SUBSETS.find((candidate) => candidate.ranges.some(([start, end]) => codePoint >= start && codePoint <= end)) || null;
  FONT_BY_CODEPOINT.set(codePoint, subset);
  return subset;
}

function registerSubset(doc, subset, registered) {
  if (!subset || registered.has(subset.name)) return;
  doc.registerFont(subset.name, subset.path);
  registered.add(subset.name);
}

function characterFont(doc, character, registered) {
  const subset = subsetFor(character);
  if (!subset) return 'Helvetica';
  registerSubset(doc, subset, registered);
  return subset.name;
}

function safeDate(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : new Date('2000-01-01T00:00:00.000Z');
}

function formatTime(value) {
  if (!value) return '未提供';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return clean(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(parsed));
  const part = (type) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}/${part('month')}/${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
}

function money(value, currency = 'TWD') {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '未提供';
  return `${clean(currency) || 'TWD'} ${new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 }).format(amount)}`;
}

function packageFrom(payload) {
  const version = payload.version || {};
  const snapshot = first(version, ['snapshot', 'contract_snapshot'], {}) || {};
  return first(version, ['documentPackage', 'contractPackage', 'package'],
    first(snapshot, ['documentPackage', 'contractPackage', 'package'], {})) || {};
}

function attachmentRows(payload, documentPackage) {
  const manifest = first(payload.packageValidation, ['manifest'], first(payload.version, ['manifest', 'bundle_manifest'], []));
  if (Array.isArray(manifest) && manifest.length) return manifest;
  return [
    { category: 'contract_body', ...(documentPackage.contractBody || {}) },
    ...(documentPackage.constructionDrawings || []).map((item) => ({ category: 'construction_drawing', ...item })),
    { category: 'quotation', ...(documentPackage.quotation || {}) },
  ].filter((item) => clean(item.name || item.fileName || item.fileId));
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw rendererError('INVALID_RENDER_PAYLOAD', 'PDF render body must be a JSON object.');
  }
  if (!KINDS.has(payload.kind)) throw rendererError('INVALID_RENDER_KIND', 'kind must be issued_pdf or signed_pdf.');
  if (!payload.contract || typeof payload.contract !== 'object' || !payload.version || typeof payload.version !== 'object') {
    throw rendererError('CONTRACT_RENDER_DATA_REQUIRED', 'contract and version are required.');
  }
  if (payload.kind === 'signed_pdf') {
    const signature = payload.signature || {};
    if (!clean(signature.base64) || !clean(payload.ipAddress) || !payload.times || !clean(payload.bundleHash)) {
      throw rendererError('SIGNED_EVIDENCE_REQUIRED', 'Signed PDF requires signature, IP, timeline, and bundle hash.');
    }
    const bytes = Buffer.from(signature.base64, 'base64');
    if (!bytes.length || bytes.length > MAX_SIGNATURE_BYTES) {
      throw rendererError('SIGNATURE_IMAGE_SIZE', 'Signature image size is invalid.', 413);
    }
  }
  return payload;
}

function createWriter(doc) {
  const registered = new Set();
  const right = PAGE.width - PAGE.margin;
  const bottom = PAGE.height - 58;

  function ensure(height = 22) {
    if (doc.y + height <= bottom) return;
    doc.addPage();
    doc.y = PAGE.margin;
  }

  function widthOf(character, fontName, size) {
    doc.font(fontName).fontSize(size);
    return doc.widthOfString(character);
  }

  function paragraph(value, options = {}) {
    const text = clean(value) || '未提供';
    const size = options.size || 10;
    const color = options.color || '#243043';
    const x = options.x ?? PAGE.margin;
    const maxWidth = options.width ?? (right - x);
    const lineHeight = options.lineHeight || size * 1.65;
    let cursorX = x;
    ensure(lineHeight);
    doc.fillColor(color);
    for (const character of [...text]) {
      if (character === '\n') {
        doc.y += lineHeight;
        cursorX = x;
        ensure(lineHeight);
        continue;
      }
      const fontName = characterFont(doc, character, registered);
      const charWidth = widthOf(character, fontName, size);
      if (cursorX > x && cursorX + charWidth > x + maxWidth) {
        doc.y += lineHeight;
        cursorX = x;
        ensure(lineHeight);
      }
      doc.font(fontName).fontSize(size).fillColor(color).text(character, cursorX, doc.y, { lineBreak: false });
      cursorX += charWidth;
    }
    doc.y += lineHeight + (options.after ?? 3);
  }

  function heading(value, level = 1) {
    const size = level === 1 ? 16 : 12;
    ensure(size * 2.2);
    if (level === 1) {
      doc.moveTo(PAGE.margin, doc.y - 5).lineTo(PAGE.margin + 5, doc.y - 5).lineWidth(4).strokeColor('#2563eb').stroke();
    }
    paragraph(value, { size, color: level === 1 ? '#0f172a' : '#1e3a5f', lineHeight: size * 1.55, after: 5 });
  }

  function labelValue(label, value) {
    ensure(20);
    const startY = doc.y;
    paragraph(label, { x: PAGE.margin, width: 112, size: 9, color: '#64748b', after: 0 });
    doc.y = startY;
    paragraph(value, { x: PAGE.margin + 120, width: right - PAGE.margin - 120, size: 10, after: 2 });
  }

  function rule() {
    ensure(12);
    doc.moveTo(PAGE.margin, doc.y + 2).lineTo(right, doc.y + 2).lineWidth(0.6).strokeColor('#cbd5e1').stroke();
    doc.y += 12;
  }

  function table(title, rows, columns) {
    heading(title, 1);
    if (!rows.length) return paragraph('未提供');
    rows.forEach((row, index) => {
      ensure(38);
      paragraph(`${index + 1}. ${clean(row[columns[0].field]) || columns[0].fallback || '未命名'}`, { size: 10, color: '#0f172a', after: 1 });
      for (const column of columns.slice(1)) {
        const raw = typeof column.format === 'function' ? column.format(row) : row[column.field];
        if (raw !== undefined && raw !== null && clean(raw)) labelValue(column.label, raw);
      }
      if (index < rows.length - 1) rule();
    });
  }

  return { paragraph, heading, labelValue, rule, table, ensure };
}

function renderContractPdf(payload) {
  const contract = payload.contract;
  const version = payload.version;
  const documentPackage = packageFrom(payload);
  const times = payload.times || {};
  const createdAt = payload.kind === 'signed_pdf'
    ? first(times, ['confirmedAt', 'signedAt', 'issuedAt'])
    : first(version, ['issuedAt', 'issued_at', 'frozenAt', 'frozen_at', 'createdAt', 'created_at']);
  const doc = new PDFDocument({
    size: PAGE.size,
    margins: { top: PAGE.margin, right: PAGE.margin, bottom: 60, left: PAGE.margin },
    bufferPages: true,
    autoFirstPage: true,
    info: {
      Title: clean(first(contract, ['title', 'contractTitle', 'contract_title'])) || '工程合約',
      Author: '工程 AM',
      Subject: payload.kind === 'signed_pdf' ? '工程合約簽署完成文件' : '工程合約簽發文件',
      CreationDate: safeDate(createdAt),
      ModDate: safeDate(createdAt),
    },
  });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const writer = createWriter(doc);

  writer.paragraph(payload.kind === 'signed_pdf' ? '工程合約 - 電子簽署完成版' : '工程合約 - 正式簽發版', {
    size: 20, color: '#0f2742', lineHeight: 30, after: 2,
  });
  writer.paragraph(`文件版本 v${first(version, ['versionNo', 'version_no'], '1')} ｜ 由工程 AM 產製`, { size: 9, color: '#64748b', after: 10 });
  writer.rule();

  writer.heading('合約基本資料');
  writer.labelValue('合約編號', first(contract, ['contractNumber', 'contract_number'], contract.id));
  writer.labelValue('合約名稱', first(contract, ['title', 'contractTitle', 'contract_title']));
  writer.labelValue('工程專案', first(contract, ['projectCode', 'project_code', 'projectId', 'project_id']));
  writer.labelValue('工種', first(contract, ['trade'], '未指定'));
  writer.labelValue('承攬對象', first(contract, ['counterpartyCompany', 'counterparty_company', 'counterpartyName', 'counterparty_name']));
  writer.labelValue('合約金額', money(contract.amount, contract.currency));
  const bodySummary = first(documentPackage, ['contractBodyText', 'bodyText', 'contractTerms', 'terms'],
    first(version.snapshot, ['contractBodyText', 'bodyText', 'contractTerms'], '合約本文以本版本附件及其 SHA-256 雜湊為準。'));
  writer.heading('合約本文');
  writer.paragraph(bodySummary);

  const payments = first(documentPackage, ['paymentMilestones', 'paymentTerms'], []);
  writer.table('付款條件', Array.isArray(payments) ? payments : [], [
    { field: 'label', fallback: '付款節點' },
    { label: '比例／金額', format: (row) => `${row.percentage ?? '未定'}% ／ ${money(row.amount, contract.currency)}` },
    { field: 'dueDate', label: '付款日期' },
    { field: 'dueTime', label: '付款時間' },
    { field: 'trigger', label: '付款條件' },
  ]);

  const acceptance = first(documentPackage, ['acceptanceCriteria', 'acceptanceStandards'], []);
  writer.table('驗收標準', Array.isArray(acceptance) ? acceptance : [], [
    { field: 'criterion', fallback: '驗收項目' },
    { field: 'reference', label: '依據' },
    { field: 'verificationMethod', label: '驗證方式' },
    { field: 'passCondition', label: '通過條件' },
    { field: 'evidenceRequired', label: '必要證據' },
  ]);

  writer.table('附件與文件雜湊', attachmentRows(payload, documentPackage), [
    { field: 'name', fallback: '附件' },
    { field: 'category', label: '文件類型' },
    { field: 'revision', label: '版次' },
    { field: 'sha256', label: 'SHA-256' },
  ]);

  writer.heading('不可變版本證據');
  writer.labelValue('Bundle SHA-256', first(payload, ['bundleHash', 'frozenBundleSha256'], first(version, ['attachmentManifestHash', 'attachment_manifest_hash', 'bundleSha256', 'bundle_sha256'])));
  writer.labelValue('文件 SHA-256', first(payload, ['documentHash'], first(version, ['issuedPdfSha256', 'issued_pdf_sha256'], '產出後由服務回傳標頭確認')));

  if (payload.kind === 'signed_pdf') {
    writer.heading('電子簽署證據');
    writer.labelValue('簽署者', first(contract, ['counterpartyName', 'counterparty_name'], '指定簽署人'));
    writer.labelValue('IP 位址', payload.ipAddress);
    writer.labelValue('簽發時間', formatTime(times.issuedAt));
    writer.labelValue('LINE 送達時間', formatTime(times.sentAt));
    writer.labelValue('驗證收件時間', formatTime(times.receivedAt));
    writer.labelValue('簽署時間', formatTime(times.signedAt));
    writer.labelValue('我方確認時間', formatTime(times.confirmedAt));
    writer.labelValue('Bundle SHA-256', payload.bundleHash);
    writer.labelValue('簽名 SHA-256', payload.signature?.sha256);
    writer.ensure(145);
    writer.paragraph('簽名', { size: 11, color: '#1e3a5f', after: 4 });
    const signature = Buffer.from(payload.signature.base64, 'base64');
    try {
      doc.image(signature, PAGE.margin, doc.y, { fit: [260, 105], align: 'left', valign: 'center' });
    } catch {
      throw rendererError('SIGNATURE_IMAGE_INVALID', 'Signature must be a valid PNG or JPEG image.', 422);
    }
    doc.rect(PAGE.margin, doc.y, 280, 115).lineWidth(0.7).strokeColor('#94a3b8').stroke();
    doc.y += 126;
  }

  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(index);
    doc.font('Helvetica').fontSize(8).fillColor('#64748b')
      .text(`Engineering AM  |  ${index + 1} / ${range.count}`, PAGE.margin, PAGE.height - 90, {
        width: PAGE.width - (PAGE.margin * 2), align: 'center', lineBreak: false,
      });
  }
  doc.end();
  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

function safeTokenEqual(actual, expected) {
  const left = Buffer.from(clean(actual));
  const right = Buffer.from(clean(expected));
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function readBody(req, maxBytes) {
  const declared = Number(req.headers?.['content-length'] || 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw rendererError('RENDER_BODY_TOO_LARGE', 'Render request is too large.', 413);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw rendererError('RENDER_BODY_TOO_LARGE', 'Render request is too large.', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw rendererError('INVALID_JSON_BODY', 'Render request must be valid JSON.');
  }
}

function sendError(res, error) {
  const status = Number(error?.statusCode) || 500;
  const safe = status >= 400 && status <= 599 ? status : 500;
  res.writeHead(safe, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify({ error: { code: safe === 500 ? 'PDF_RENDER_FAILED' : clean(error.code), message: safe === 500 ? 'PDF render failed.' : clean(error.message) } }));
}

function pruneCache(cache, now) {
  for (const [key, value] of cache) if (now - value.at > CACHE_TTL_MS) cache.delete(key);
  while (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
}

export function createEngineeringContractPdfRenderHandler(options = {}) {
  const cache = options.cache || new Map();
  const maxBodyBytes = Number(options.maxBodyBytes || MAX_BODY_BYTES);
  const resolveToken = options.resolveToken || ((ctx) => ctx?.tenant?.config?.contracts?.pdfRenderToken);
  const render = options.render || renderContractPdf;

  return async function handleEngineeringContractPdfRender(req, res, ctx = {}) {
    if (ctx.pathname !== ENGINEERING_CONTRACT_PDF_RENDER_PATH) return false;
    try {
      if (req.method !== 'POST') throw rendererError('METHOD_NOT_ALLOWED', 'Only POST is allowed.', 405);
      const expectedToken = clean(await resolveToken(ctx));
      if (Buffer.byteLength(expectedToken, 'utf8') < 32) throw rendererError('PDF_RENDERER_NOT_CONFIGURED', 'PDF renderer is not configured.', 503);
      const authorization = clean(req.headers?.authorization);
      const suppliedToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      if (!safeTokenEqual(suppliedToken, expectedToken)) throw rendererError('UNAUTHORIZED', 'Unauthorized.', 401);
      const idempotencyKey = clean(req.headers?.['idempotency-key']);
      if (!/^[A-Za-z0-9:_./-]{12,240}$/.test(idempotencyKey)) {
        throw rendererError('IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key is required.');
      }
      const rawPayload = await readBody(req, maxBodyBytes);
      const payload = validatePayload(rawPayload);
      const requestHash = sha256(Buffer.from(canonical(payload)));
      const cached = cache.get(idempotencyKey);
      if (cached) {
        if (cached.requestHash !== requestHash) throw rendererError('IDEMPOTENCY_CONFLICT', 'Idempotency key was used for a different payload.', 409);
        res.writeHead(200, cached.headers);
        res.end(cached.buffer);
        return true;
      }
      const buffer = await render(payload);
      if (!Buffer.isBuffer(buffer) || !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        throw rendererError('PDF_OUTPUT_INVALID', 'Renderer did not produce a valid PDF.', 500);
      }
      const contentHash = sha256(buffer);
      const headers = {
        'Content-Type': 'application/pdf',
        'Content-Length': String(buffer.length),
        'Content-Disposition': `inline; filename="${payload.kind}.pdf"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Content-Sha256': contentHash,
      };
      pruneCache(cache, Date.now());
      cache.set(idempotencyKey, { requestHash, buffer, headers, at: Date.now() });
      res.writeHead(200, headers);
      res.end(buffer);
      return true;
    } catch (error) {
      sendError(res, error);
      return true;
    }
  };
}

const sharedHandler = createEngineeringContractPdfRenderHandler();

export function handleEngineeringContractPdfRender(req, res, ctx) {
  return sharedHandler(req, res, ctx);
}

export const __test = {
  FONT_SUBSETS,
  subsetFor,
  canonical,
  validatePayload,
  renderContractPdf,
  safeTokenEqual,
};
