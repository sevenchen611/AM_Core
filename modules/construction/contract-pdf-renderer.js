import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import PDFDocument from 'pdfkit';

export const ENGINEERING_CONTRACT_PDF_RENDER_PATH = '/internal/v1/engineering-contracts/render';

const MAX_BODY_BYTES = 6 * 1024 * 1024;
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 200;
const CACHE_TTL_MS = 15 * 60 * 1000;
const KINDS = new Set(['draft_review_pdf', 'issued_pdf', 'signed_pdf']);
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
  if (value === null || value === undefined || clean(value) === '') return '未提供';
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
  return [
    { category: 'contract_body', ...(documentPackage.contractBody || {}) },
    ...(documentPackage.constructionDrawings || []).map((item) => ({ category: 'construction_drawing', ...item })),
    { category: 'quotation', ...(documentPackage.quotation || {}) },
    ...(Array.isArray(documentPackage.attachments)
      ? documentPackage.attachments.filter((item) => item?.inherited !== true)
      : []),
  ].filter((item) => clean(item.name || item.fileName || item.fileId));
}

function historicalAttachmentRows(documentPackage) {
  return (Array.isArray(documentPackage.attachments) ? documentPackage.attachments : [])
    .filter((item) => item?.inherited === true)
    .map((item) => ({
      ...item,
      sourceVersion: item.sourceVersionNo ? `V${item.sourceVersionNo}` : (item.revision || '舊版'),
    }));
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw rendererError('INVALID_RENDER_PAYLOAD', 'PDF render body must be a JSON object.');
  }
  if (!KINDS.has(payload.kind)) throw rendererError('INVALID_RENDER_KIND', 'kind must be draft_review_pdf, issued_pdf, or signed_pdf.');
  if (!payload.contract || typeof payload.contract !== 'object' || !payload.version || typeof payload.version !== 'object') {
    throw rendererError('CONTRACT_RENDER_DATA_REQUIRED', 'contract and version are required.');
  }
  if (payload.kind === 'signed_pdf') {
    const signature = payload.signature || {};
    const party = payload.counterpartyDetails || {};
    if (!clean(signature.base64) || !clean(payload.ipAddress) || !payload.times || !clean(payload.bundleHash)) {
      throw rendererError('SIGNED_EVIDENCE_REQUIRED', 'Signed PDF requires signature, IP, timeline, and bundle hash.');
    }
    if (!clean(party.name) || !clean(party.address) || !/^[A-Z0-9-]{6,30}$/.test(clean(party.identityNumber).toUpperCase())) {
      throw rendererError('COUNTERPARTY_DETAILS_REQUIRED', 'Signed PDF requires contractor name, identity number, and address.');
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
  const bottom = PAGE.height - 110;

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

  function fixedText(value, options = {}) {
    const text = clean(value);
    if (!text) return;
    const size = options.size || 8;
    const color = options.color || '#64748b';
    const x = options.x ?? PAGE.margin;
    const width = options.width ?? (right - x);
    const characters = [...text].map((character) => {
      const fontName = characterFont(doc, character, registered);
      return { character, fontName, width: widthOf(character, fontName, size) };
    });
    const totalWidth = characters.reduce((sum, item) => sum + item.width, 0);
    let cursorX = options.align === 'center' ? x + Math.max(0, (width - totalWidth) / 2) : x;
    for (const item of characters) {
      doc.font(item.fontName).fontSize(size).fillColor(color)
        .text(item.character, cursorX, options.y, { lineBreak: false });
      cursorX += item.width;
    }
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

  function wrapLines(value, width, size = 9) {
    const lines = [];
    let line = '';
    let lineWidth = 0;
    const push = () => { lines.push(line || ' '); line = ''; lineWidth = 0; };
    for (const character of [...(clean(value) || '未提供')]) {
      if (character === '\n') { push(); continue; }
      const fontName = characterFont(doc, character, registered);
      const charWidth = widthOf(character, fontName, size);
      if (line && lineWidth + charWidth > width) push();
      line += character;
      lineWidth += charWidth;
    }
    if (line || !lines.length) push();
    return lines;
  }

  function drawLine(value, x, y, size, color) {
    let cursorX = x;
    for (const character of [...value]) {
      const fontName = characterFont(doc, character, registered);
      doc.font(fontName).fontSize(size).fillColor(color).text(character, cursorX, y, { lineBreak: false });
      cursorX += widthOf(character, fontName, size);
    }
  }

  function gridRows(rows, widths, options = {}) {
    const x = options.x ?? PAGE.margin;
    const size = options.size || 8.5;
    const lineHeight = options.lineHeight || size * 1.55;
    const paddingX = options.paddingX ?? 6;
    const paddingY = options.paddingY ?? 5;
    const headerRows = options.headerRows ?? 0;
    rows.forEach((row, rowIndex) => {
      const cells = widths.map((width, columnIndex) => wrapLines(row[columnIndex], width - (paddingX * 2), size));
      const rowHeight = gridRowHeight(row, widths, options);
      ensure(rowHeight + 1);
      const rowY = doc.y;
      let cellX = x;
      widths.forEach((width, columnIndex) => {
        if (rowIndex < headerRows) doc.rect(cellX, rowY, width, rowHeight).fill('#e8f0ec');
        doc.rect(cellX, rowY, width, rowHeight).lineWidth(0.7).strokeColor('#94a3b8').stroke();
        cells[columnIndex].forEach((line, lineIndex) => drawLine(
          line, cellX + paddingX, rowY + paddingY + (lineIndex * lineHeight), size,
          rowIndex < headerRows ? '#173f2a' : '#243043',
        ));
        cellX += width;
      });
      doc.y = rowY + rowHeight;
    });
    doc.y += options.after ?? 8;
  }

  function gridRowHeight(row, widths, options = {}) {
    const size = options.size || 8.5;
    const lineHeight = options.lineHeight || size * 1.55;
    const paddingX = options.paddingX ?? 6;
    const paddingY = options.paddingY ?? 5;
    const lineCounts = widths.map((width, columnIndex) => wrapLines(
      row[columnIndex], width - (paddingX * 2), size,
    ).length);
    return Math.max(24, Math.max(...lineCounts) * lineHeight + (paddingY * 2));
  }

  function gridTable(title, rows, columns) {
    const widths = columns.map((column) => column.width);
    const tableRows = [columns.map((column) => column.label), ...rows.map((row) => columns.map((column) => {
      const raw = typeof column.format === 'function' ? column.format(row) : row[column.field];
      return clean(raw) || '未提供';
    }))];
    const firstRowsHeight = tableRows.slice(0, Math.min(2, tableRows.length))
      .reduce((sum, row) => sum + gridRowHeight(row, widths), 0);
    ensure(36 + firstRowsHeight);
    heading(title, 1);
    if (!rows.length) return paragraph('未提供');
    gridRows(tableRows, widths, { headerRows: 1 });
  }

  function documentBlocks(blocks) {
    for (const block of blocks) {
      if (block.type === 'table') {
        const columnCount = Math.max(...block.rows.map((row) => row.length));
        const width = (PAGE.width - (PAGE.margin * 2)) / Math.max(1, columnCount);
        gridRows(block.rows.map((row) => Array.from({ length: columnCount }, (_, index) => row[index] || '')), Array(columnCount).fill(width), {
          headerRows: 0, size: 8.5, after: 7,
        });
      } else if (block.type === 'heading') {
        heading(block.text, block.level <= 2 ? 1 : 2);
      } else {
        paragraph(block.text, { size: 9.5, lineHeight: 16, after: 4 });
      }
    }
  }

  function rule() {
    ensure(12);
    doc.moveTo(PAGE.margin, doc.y + 2).lineTo(right, doc.y + 2).lineWidth(0.6).strokeColor('#cbd5e1').stroke();
    doc.y += 12;
  }

  function table(title, rows, columns) {
    const available = PAGE.width - (PAGE.margin * 2);
    const width = available / columns.length;
    return gridTable(title, rows, columns.map((column, index) => ({
      ...column,
      label: column.label || column.fallback || `欄位 ${index + 1}`,
      width,
    })));
  }

  return { paragraph, fixedText, heading, labelValue, rule, table, gridRows, gridTable, documentBlocks, ensure };
}

function decodeHtml(value) {
  return clean(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function contractBodyBlocks(html) {
  const source = clean(html);
  if (!source) return [];
  const blocks = [];
  const pattern = /<table\b[\s\S]*?<\/table>|<h[1-6]\b[\s\S]*?<\/h[1-6]>|<p\b[\s\S]*?<\/p>|<li\b[\s\S]*?<\/li>/gi;
  for (const match of source.matchAll(pattern)) {
    const fragment = match[0];
    if (/^<table\b/i.test(fragment)) {
      const rows = [...fragment.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((rowMatch) => (
        [...rowMatch[0].matchAll(/<(?:td|th)\b[\s\S]*?<\/(?:td|th)>/gi)]
          .map((cell) => decodeHtml(cell[0]))
      )).filter((row) => row.length);
      if (rows.length) blocks.push({ type: 'table', rows });
      continue;
    }
    const value = decodeHtml(fragment);
    if (!value) continue;
    const headingMatch = /^<h([1-6])\b/i.exec(fragment);
    blocks.push({
      type: headingMatch ? 'heading' : 'paragraph',
      level: headingMatch ? Number(headingMatch[1]) : undefined,
      text: /^<li\b/i.test(fragment) ? `• ${value}` : value,
    });
  }
  return blocks;
}

function paymentTable(writer, payments, contract, title = '付款條件表') {
  writer.gridTable(title, Array.isArray(payments) ? payments : [], [
    { field: 'label', label: '付款節點', width: 84 },
    { label: '比例／金額', width: 115, format: (row) => `${row.percentage ?? '未定'}% ／ ${money(row.amount, contract.currency)}` },
    { field: 'dueDate', label: '付款日期', width: 72 },
    { field: 'dueTime', label: '付款時間', width: 58 },
    { field: 'trigger', label: '施工里程碑／付款條件', width: 170 },
  ]);
}

function acceptanceTable(writer, acceptance, title = '專案驗收標準表') {
  writer.gridTable(title, Array.isArray(acceptance) ? acceptance : [], [
    { field: 'criterion', label: '驗收項目', width: 118 },
    { field: 'reference', label: '依據', width: 84 },
    { field: 'verificationMethod', label: '驗證方式', width: 92 },
    { field: 'passCondition', label: '通過條件', width: 110 },
    { field: 'evidenceRequired', label: '必要證據', width: 95 },
  ]);
}

function isPaymentGeneralClause(block) {
  const value = clean(block?.text);
  return block?.type !== 'table'
    && /發票|請款|稅|匯款|付款帳戶/.test(value)
    && !/^第[一二三四五六七八九十]+期/.test(value)
    && !/期款|尾款|設備器具/.test(value);
}

function renderStructuredContractBody(writer, blocks, payments, acceptance, contract) {
  let paymentRendered = false;
  let acceptanceRendered = false;
  let skipOldPayment = false;
  let insideAcceptance = false;
  const paymentHeadingIndex = blocks.findIndex((block) => /^第五條\s*[：:]?/.test(clean(block.text)));
  const paymentEndIndex = paymentHeadingIndex < 0 ? -1
    : blocks.findIndex((block, index) => index > paymentHeadingIndex && /^第六條\s*[：:]?/.test(clean(block.text)));
  const paymentGeneral = paymentHeadingIndex >= 0
    ? blocks.slice(paymentHeadingIndex + 1, paymentEndIndex < 0 ? blocks.length : paymentEndIndex).filter(isPaymentGeneralClause)
    : [];

  for (const block of blocks) {
    const value = clean(block.text);
    if (/^第五條\s*[：:]?/.test(value) && payments.length) {
      writer.documentBlocks([block]);
      writer.paragraph('本工程各期付款節點、比例、金額、日期及付款條件，以本條下列付款條件表為準。', {
        size: 9.5, lineHeight: 16, after: 5,
      });
      paymentTable(writer, payments, contract);
      if (paymentGeneral.length) writer.documentBlocks(paymentGeneral);
      else writer.paragraph('乙方應依各期約定完成條件並檢附合法請款文件，甲方依表列條件辦理付款。', {
        size: 9.5, lineHeight: 16, after: 4,
      });
      paymentRendered = true;
      skipOldPayment = true;
      continue;
    }
    if (skipOldPayment) {
      if (!/^第六條\s*[：:]?/.test(value)) continue;
      skipOldPayment = false;
    }
    if (/\{\{PAYMENT_(?:TERMS|SCHEDULE)_TABLE\}\}/i.test(value) && payments.length) {
      paymentTable(writer, payments, contract);
      paymentRendered = true;
      continue;
    }
    if (/^第十條\s*[：:]?/.test(value)) insideAcceptance = true;
    if (/^第十一條\s*[：:]?/.test(value) && insideAcceptance && acceptance.length && !acceptanceRendered) {
      writer.paragraph('本工程具體驗收項目、驗證方式及合格條件，以本條下列專案驗收標準表為準。', {
        size: 9.5, lineHeight: 16, after: 5,
      });
      acceptanceTable(writer, acceptance);
      acceptanceRendered = true;
      insideAcceptance = false;
    }
    if (/\{\{ACCEPTANCE_(?:CRITERIA|STANDARDS)_TABLE\}\}/i.test(value) && acceptance.length) {
      acceptanceTable(writer, acceptance);
      acceptanceRendered = true;
      continue;
    }
    writer.documentBlocks([block]);
  }
  if (insideAcceptance && acceptance.length && !acceptanceRendered) {
    writer.paragraph('本工程具體驗收項目、驗證方式及合格條件，以本條下列專案驗收標準表為準。', {
      size: 9.5, lineHeight: 16, after: 5,
    });
    acceptanceTable(writer, acceptance);
    acceptanceRendered = true;
  }
  return { paymentRendered, acceptanceRendered };
}

function partyProfiles(contract, counterpartyDetails = {}) {
  const partyA = {
    organization: first(contract, ['partyACompany', 'party_a_company', 'ownerCompany', 'owner_company', 'clientCompany', 'client_company']),
    taxId: first(contract, ['partyATaxId', 'party_a_tax_id', 'ownerTaxId', 'owner_tax_id', 'clientTaxId', 'client_tax_id']),
    responsiblePerson: first(contract, ['partyAResponsiblePerson', 'party_a_responsible_person', 'ownerResponsiblePerson', 'owner_responsible_person']),
    representative: first(contract, ['partyARepresentative', 'party_a_representative', 'ownerRepresentative', 'owner_representative']),
    identityNumber: first(contract, ['partyAIdentityNumber', 'party_a_identity_number', 'ownerIdentityNumber', 'owner_identity_number']),
    address: first(contract, ['partyAAddress', 'party_a_address', 'ownerAddress', 'owner_address', 'clientAddress', 'client_address']),
  };
  const partyB = {
    organization: first(contract, ['counterpartyCompany', 'counterparty_company']),
    taxId: first(contract, ['counterpartyTaxId', 'counterparty_tax_id', 'counterpartyRegistrationNumber', 'counterparty_registration_number']),
    responsiblePerson: first(contract, ['counterpartyResponsiblePerson', 'counterparty_responsible_person']),
    representative: clean(counterpartyDetails.name) || first(contract, ['counterpartyRepresentative', 'counterparty_representative', 'counterpartyName', 'counterparty_name']),
    identityNumber: clean(counterpartyDetails.identityNumber) || first(contract, ['counterpartyIdentityNumber', 'counterparty_identity_number']),
    address: clean(counterpartyDetails.address) || first(contract, ['counterpartyAddress', 'counterparty_address']),
  };
  return { partyA, partyB };
}

export function renderDraftReviewHistoryAppendix(payload = {}) {
  const reviews = Array.isArray(payload.reviews) ? payload.reviews : [];
  if (!reviews.length) return Promise.resolve(null);
  const createdAt = reviews.at(-1)?.respondedAt || reviews.at(-1)?.responded_at;
  const doc = new PDFDocument({
    size: PAGE.size,
    margins: { top: PAGE.margin, right: PAGE.margin, bottom: 60, left: PAGE.margin },
    bufferPages: true,
    autoFirstPage: true,
    info: {
      Title: `${clean(payload.contractNumber) || '工程合約'} 草約審閱意見歷程`,
      Author: '工程 AM',
      Subject: '草約各版本審閱意見歷程',
      CreationDate: safeDate(createdAt),
      ModDate: safeDate(createdAt),
    },
  });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const writer = createWriter(doc);
  writer.paragraph('草約審閱意見歷程', { size: 20, color: '#0f2742', lineHeight: 30, after: 2 });
  writer.paragraph(`${clean(payload.contractNumber)} ${clean(payload.title)} ｜ 截至 V${clean(payload.currentVersionNo) || '—'}`, {
    size: 10, color: '#64748b', after: 8,
  });
  writer.paragraph('以下內容依時間保留各版本審閱意見，僅作為草約協商過程紀錄，不代表正式簽署或同意締約。', {
    size: 10, color: '#991b1b', lineHeight: 17, after: 8,
  });
  writer.rule();
  reviews.forEach((review, index) => {
    const decision = clean(review.decision || review.status) === 'no_changes' ? '暫無修改意見' : '提出修改';
    writer.heading(`${index + 1}. V${review.versionNo ?? review.version_no ?? '—'}｜${decision}`, 1);
    writer.labelValue('回覆人', review.reviewerName || review.reviewer_name || '未提供');
    writer.labelValue('回覆時間', formatTime(review.respondedAt || review.responded_at));
    writer.labelValue('意見內容', review.responseNotes || review.response_notes
      || (decision === '暫無修改意見' ? '目前暫無修改意見' : '未提供其他說明'));
    if (index < reviews.length - 1) writer.rule();
  });
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(index);
    writer.fixedText(`草約審閱意見歷程｜不得簽署  |  Engineering AM  |  ${index + 1} / ${range.count}`, {
      x: PAGE.margin, y: PAGE.height - 90, width: PAGE.width - (PAGE.margin * 2), align: 'center', size: 8,
    });
  }
  doc.end();
  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

export function renderLineConversationArchive(payload = {}) {
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const doc = new PDFDocument({
    size: PAGE.size,
    margins: { top: PAGE.margin, right: PAGE.margin, bottom: 60, left: PAGE.margin },
    bufferPages: true,
    autoFirstPage: true,
    info: {
      Title: `${clean(payload.contractNumber) || '工程合約'} V${clean(payload.versionNo) || '—'} LINE 對話封存`,
      Author: '工程 AM',
      Subject: '工程合約 LINE 群組對話截圖式封存',
      CreationDate: safeDate(payload.endedAt),
      ModDate: safeDate(payload.endedAt),
    },
  });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const writer = createWriter(doc);
  writer.paragraph('LINE 群組對話截圖式封存', { size: 20, color: '#0f2742', lineHeight: 30, after: 2 });
  writer.paragraph(`${clean(payload.contractNumber)} ${clean(payload.title)} ｜ V${clean(payload.versionNo) || '—'} ｜ ${clean(payload.stageLabel)}`, {
    size: 10, color: '#64748b', after: 5,
  });
  writer.labelValue('LINE 群組', clean(payload.groupName) || '未提供');
  writer.labelValue('封存區間', `${payload.startedAfter ? `${formatTime(payload.startedAfter)} 之後` : '系統最早保存訊息'} ～ ${formatTime(payload.endedAt)}`);
  writer.labelValue('訊息數量', String(messages.length));
  writer.paragraph('本檔案由工程 AM 依已落庫的 LINE 訊息自動排版，並非 LINE 官方匯出畫面；原始訊息 ID、時間與檔案雜湊另存於封存證據。', {
    size: 9, color: '#991b1b', lineHeight: 16, after: 8,
  });
  writer.rule();
  if (!messages.length) writer.paragraph('此封存區間沒有已落庫的 LINE 訊息。', { size: 11, color: '#64748b' });
  let activeDay = '';
  messages.forEach((message, index) => {
    const day = formatTime(message.time).slice(0, 10);
    if (day !== activeDay) {
      activeDay = day;
      writer.heading(day, 1);
    }
    writer.paragraph(`${formatTime(message.time).slice(11, 19)}　${clean(message.sender) || '未知發言人'}`, {
      size: 9, color: '#166534', lineHeight: 15, after: 1,
    });
    writer.paragraph(clean(message.content) || `[${clean(message.messageType) || '其他訊息'}]`, {
      x: PAGE.margin + 14, width: PAGE.width - (PAGE.margin * 2) - 28,
      size: 10, color: '#1f2937', lineHeight: 17, after: 3,
    });
    for (const attachment of Array.isArray(message.attachments) ? message.attachments : []) {
      writer.paragraph(`附件：${clean(attachment.name) || '未命名檔案'}${attachment.sha256 ? ` ｜ SHA-256 ${attachment.sha256}` : ''}`, {
        x: PAGE.margin + 14, width: PAGE.width - (PAGE.margin * 2) - 28,
        size: 8, color: '#64748b', lineHeight: 13, after: 2,
      });
      if (Buffer.isBuffer(attachment.buffer) && /^image\/(png|jpeg)$/.test(clean(attachment.mimeType))) {
        writer.ensure(190);
        try {
          doc.image(attachment.buffer, PAGE.margin + 14, doc.y, { fit: [390, 180], align: 'left', valign: 'top' });
          doc.y += 188;
        } catch {
          writer.paragraph('（圖片無法嵌入，但原始附件名稱與雜湊已保留。）', { size: 8, color: '#991b1b' });
        }
      }
    }
    writer.paragraph(`LINE 訊息 ID：${clean(message.messageId) || clean(message.pageId) || '未提供'}`, {
      x: PAGE.margin + 14, size: 7, color: '#94a3b8', lineHeight: 11, after: 1,
    });
    if (index < messages.length - 1) writer.rule();
  });
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(index);
    writer.fixedText(`LINE 對話封存｜V${clean(payload.versionNo) || '—'}｜Engineering AM｜${index + 1} / ${range.count}`, {
      x: PAGE.margin, y: PAGE.height - 90, width: PAGE.width - (PAGE.margin * 2), align: 'center', size: 8,
    });
  }
  doc.end();
  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
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
      Subject: payload.kind === 'signed_pdf' ? '工程合約簽署完成文件'
        : (payload.kind === 'draft_review_pdf' ? '工程合約草約審閱文件' : '工程合約簽發文件'),
      CreationDate: safeDate(createdAt),
      ModDate: safeDate(createdAt),
    },
  });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const writer = createWriter(doc);

  const isDraftReview = payload.kind === 'draft_review_pdf';
  writer.paragraph(payload.kind === 'signed_pdf' ? '工程合約 - 電子簽署完成版'
    : (isDraftReview ? '工程合約草約 - 僅供討論' : '工程合約 - 正式簽發版'), {
    size: 20, color: '#0f2742', lineHeight: 30, after: 2,
  });
  writer.paragraph(`文件版本 v${first(version, ['versionNo', 'version_no'], '1')} ｜ 由工程 AM 產製`, { size: 9, color: '#64748b', after: 10 });
  if (isDraftReview) {
    writer.paragraph('本文件為草約，僅供雙方討論與提出修改意見，不是正式簽署版本；任何閱覽或意見回覆均不構成簽約、承諾或電子簽章。', {
      size: 11, color: '#b91c1c', lineHeight: 19, after: 8,
    });
    const missing = Array.isArray(payload.missingSections) ? payload.missingSections.filter(Boolean) : [];
    writer.paragraph(missing.length ? `尚待雙方確認：${missing.join('、')}` : '目前資料已具備；仍以最後正式簽署版本為準。', {
      size: 10, color: '#991b1b', lineHeight: 17, after: 8,
    });
  }
  writer.rule();

  writer.heading('合約基本資料');
  writer.labelValue('合約編號', first(contract, ['contractNumber', 'contract_number'], contract.id));
  writer.labelValue('合約名稱', first(contract, ['title', 'contractTitle', 'contract_title']));
  writer.labelValue('工程專案', first(contract, ['projectCode', 'project_code', 'projectId', 'project_id']));
  writer.labelValue('工種', first(contract, ['trade'], '未指定'));
  writer.labelValue('承攬對象', first(contract, ['counterpartyCompany', 'counterparty_company', 'counterpartyName', 'counterparty_name']));
  writer.labelValue('合約金額', money(contract.amount, contract.currency));
  const parties = partyProfiles(contract, payload.kind === 'signed_pdf' ? payload.counterpartyDetails : {});
  writer.gridTable('立約雙方資料', [
    { field: '主體／公司', partyA: parties.partyA.organization, partyB: parties.partyB.organization },
    { field: '統一編號', partyA: parties.partyA.taxId, partyB: parties.partyB.taxId },
    { field: '負責人', partyA: parties.partyA.responsiblePerson, partyB: parties.partyB.responsiblePerson },
    { field: '代表人／簽約人', partyA: parties.partyA.representative, partyB: parties.partyB.representative },
    { field: '身分證字號', partyA: parties.partyA.identityNumber, partyB: parties.partyB.identityNumber },
    { field: '地址', partyA: parties.partyA.address, partyB: parties.partyB.address },
  ], [
    { field: 'field', label: '資料項目', width: 90 },
    { field: 'partyA', label: '甲方', width: 204.5 },
    { field: 'partyB', label: '乙方', width: 204.5 },
  ]);
  const bodySummary = first(payload, ['contractBodyText'], first(documentPackage, ['contractBodyText', 'bodyText', 'contractTerms', 'terms'],
    first(version.snapshot, ['contractBodyText', 'bodyText', 'contractTerms'], '合約本文以本版本附件及其 SHA-256 雜湊為準。')));
  const payments = first(documentPackage, ['paymentMilestones', 'paymentTerms'], []);
  const acceptance = first(documentPackage, ['acceptanceCriteria', 'acceptanceStandards'], []);
  writer.heading('合約本文');
  const bodyBlocks = contractBodyBlocks(payload.contractBodyHtml);
  const embedded = bodyBlocks.length
    ? renderStructuredContractBody(writer, bodyBlocks, Array.isArray(payments) ? payments : [],
      Array.isArray(acceptance) ? acceptance : [], contract)
    : { paymentRendered: false, acceptanceRendered: false };
  if (!bodyBlocks.length) writer.paragraph(bodySummary);
  if (!embedded.paymentRendered) paymentTable(writer, payments, contract, '付款條件');
  if (!embedded.acceptanceRendered) acceptanceTable(writer, acceptance, '驗收標準');

  writer.gridTable('附件與文件雜湊', attachmentRows(payload, documentPackage), [
    { field: 'name', label: '附件', width: 152 },
    { label: '文件類型', width: 86, format: (row) => ({
      contract_body: '合約本文', construction_drawing: '施工圖', quotation: '報價單',
      line_conversation_archive: 'LINE 對話封存',
    })[clean(row.category)] || clean(row.category) },
    { field: 'revision', label: '版次', width: 52 },
    { field: 'sha256', label: 'SHA-256', width: 209 },
  ]);
  const historical = historicalAttachmentRows(documentPackage);
  if (historical.length) writer.gridTable('歷史版本證據索引（不重複併入本版正文）', historical, [
    { field: 'name', label: '歷史文件', width: 190 },
    { field: 'sourceVersion', label: '來源版本', width: 72 },
    { field: 'revision', label: '版次', width: 72 },
    { field: 'sha256', label: 'SHA-256', width: 165 },
  ]);

  writer.heading('不可變版本證據');
  writer.labelValue('Bundle SHA-256', first(payload, ['bundleHash', 'frozenBundleSha256'], first(version, ['attachmentManifestHash', 'attachment_manifest_hash', 'bundleSha256', 'bundle_sha256'])));
  writer.labelValue('文件 SHA-256', first(payload, ['documentHash'], first(version, ['issuedPdfSha256', 'issued_pdf_sha256'], '產出後由服務回傳標頭確認')));

  if (payload.kind === 'signed_pdf') {
    writer.heading('電子簽署證據');
    writer.labelValue('簽署者', clean(payload.counterpartyDetails?.name)
      || first(contract, ['counterpartyName', 'counterparty_name'], '指定簽署人'));
    writer.labelValue('IP 位址', payload.ipAddress);
    writer.labelValue('簽發時間', formatTime(times.issuedAt));
    writer.labelValue('LINE 送達時間', formatTime(times.sentAt));
    writer.labelValue('驗證收件時間', formatTime(times.receivedAt));
    writer.labelValue('簽署時間', formatTime(times.signedAt));
    writer.labelValue('我方確認時間', formatTime(times.confirmedAt));
    writer.labelValue('Bundle SHA-256', payload.bundleHash);
    writer.labelValue('簽名 SHA-256', payload.signature?.sha256);
    writer.labelValue('身分證正面收件', payload.verification?.identityDocumentsVerified
      ? `${formatTime(payload.verification.identityDocumentsReceivedAt?.front)}／SHA-256 ${clean(payload.verification.identityDocumentHashes?.front)}`
      : '未驗證');
    writer.labelValue('身分證反面收件', payload.verification?.identityDocumentsVerified
      ? `${formatTime(payload.verification.identityDocumentsReceivedAt?.back)}／SHA-256 ${clean(payload.verification.identityDocumentHashes?.back)}`
      : '未驗證');
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
    if (isDraftReview) {
      doc.save();
      doc.rotate(-32, { origin: [PAGE.width / 2, PAGE.height / 2] });
      doc.font('Helvetica-Bold').fontSize(38).fillColor('#ef4444').opacity(0.14)
        .text('DRAFT  -  NOT FOR SIGNATURE', 45, PAGE.height / 2 - 35, {
          width: PAGE.width - 90, align: 'center', lineBreak: false,
        });
      doc.restore();
      doc.opacity(1);
    }
    writer.fixedText(`${isDraftReview ? '草約｜僅供討論｜不得簽署  |  ' : ''}Engineering AM  |  ${index + 1} / ${range.count}`, {
      x: PAGE.margin, y: PAGE.height - 90, width: PAGE.width - (PAGE.margin * 2), align: 'center', size: 8,
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
  contractBodyBlocks,
  historicalAttachmentRows,
  isPaymentGeneralClause,
  renderStructuredContractBody,
};
