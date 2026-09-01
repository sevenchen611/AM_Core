import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';

import {
  ENGINEERING_CONTRACT_PDF_RENDER_PATH,
  __test,
  createEngineeringContractPdfRenderHandler,
} from '../modules/construction/contract-pdf-renderer.js';

const TOKEN = 'renderer-test-token-that-is-at-least-32-bytes-long';
const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function payload(kind = 'issued_pdf') {
  const value = {
    kind,
    contract: {
      id: 'contract-1', contractNumber: 'ZS-CT-001', title: '泥作工程承攬合約',
      projectCode: 'ZS', trade: '泥作', counterpartyName: '王大明',
      counterpartyCompany: '安心泥作工程行', amount: 360000, currency: 'TWD',
      partyACompany: '範例甲方股份有限公司', partyATaxId: '12345678',
      partyARepresentative: '甲方代表', partyAAddress: '臺中市西區甲方路 1 號',
    },
    version: {
      id: 'version-1', versionNo: 2, frozenAt: '2026-08-28T01:00:00.000Z',
      attachmentManifestHash: 'd'.repeat(64),
      snapshot: {
        documentPackage: {
          contractBodyText: '承攬人應依施工圖說、報價內容與現場指示完成泥作工程，並遵守工程安全規範。',
          contractBody: { name: '工程合約本文.pdf', fileId: 'body-1', sha256: 'a'.repeat(64) },
          constructionDrawings: [{ name: '施工圖 A1.pdf', fileId: 'drawing-1', sha256: 'b'.repeat(64), revision: 'A1' }],
          quotation: { name: '核定報價單.pdf', fileId: 'quote-1', sha256: 'c'.repeat(64) },
          paymentMilestones: [
            { label: '簽約款', percentage: 30, amount: 108000, dueDate: '2026-09-01', dueTime: '17:00' },
            { label: '驗收尾款', percentage: 70, amount: 252000, trigger: '驗收合格後七日內' },
          ],
          acceptanceCriteria: [{
            criterion: '完成面高程誤差不得超過 3 mm', reference: '施工圖 A1',
            verificationMethod: '現場量測', passCondition: '誤差小於等於 3 mm', evidenceRequired: '量測照片',
          }],
        },
      },
    },
    frozenBundleSha256: 'd'.repeat(64),
    contractBodyHtml: '<h1>工程合約書</h1><p>雙方同意條款如下。</p><table><tr><td>甲方</td><td>範例甲方股份有限公司</td><td>乙方</td><td>安心泥作工程行</td></tr><tr><td>地址</td><td>臺中市西區甲方路 1 號</td><td>地址</td><td>臺中市西屯區工程路 1 號</td></tr></table>',
  };
  if (kind === 'signed_pdf') Object.assign(value, {
    immutable: true,
    bundleHash: 'd'.repeat(64),
    documentHash: 'e'.repeat(64),
    signature: { mimeType: 'image/png', base64: ONE_PIXEL_PNG, sha256: 'f'.repeat(64) },
    ipAddress: '203.0.113.42',
    counterpartyDetails: { name: '王大明', identityNumber: 'A123456789', address: '臺中市西屯區工程路 1 號' },
    times: {
      issuedAt: '2026-08-28T01:00:00.000Z', sentAt: '2026-08-28T01:01:00.000Z',
      receivedAt: '2026-08-28T01:03:00.000Z', signedAt: '2026-08-28T01:05:00.000Z',
      confirmedAt: '2026-08-28T01:07:00.000Z',
    },
  });
  return value;
}

function request(body, token = TOKEN, idempotencyKey = 'engineering-contract-render:test:1') {
  const bytes = Buffer.from(JSON.stringify(body));
  const req = Readable.from([bytes]);
  req.method = 'POST';
  req.headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'content-length': String(bytes.length),
    'idempotency-key': idempotencyKey,
  };
  return req;
}

function response() {
  return {
    statusCode: 0,
    headers: {},
    chunks: [],
    writeHead(statusCode, headers) { this.statusCode = statusCode; Object.assign(this.headers, headers); },
    end(value = '') { this.chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value)); },
    get buffer() { return Buffer.concat(this.chunks); },
    get json() { return JSON.parse(this.buffer.toString('utf8')); },
  };
}

async function invoke(handler, body, token, key) {
  const res = response();
  const handled = await handler(request(body, token, key), res, {
    pathname: ENGINEERING_CONTRACT_PDF_RENDER_PATH,
    tenant: { key: 'engineering', config: { contracts: { pdfRenderToken: TOKEN } } },
  });
  return { handled, res };
}

async function extractText(buffer) {
  const candidates = [
    path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'),
    path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'),
  ];
  const modulePath = candidates.find((candidate) => fs.existsSync(candidate));
  assert.ok(modulePath, 'pdfjs-dist is required for the Traditional Chinese extraction dry-run');
  const pdfjs = await import(pathToFileURL(modulePath).href);
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), disableWorker: true }).promise;
  let text = '';
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    text += content.items.map((item) => item.str).join(' ');
  }
  return text;
}

assert.ok(__test.FONT_SUBSETS.length >= 100, 'all Fontsource Noto Sans TC Unicode subsets must be indexed');
for (const character of [...'工程合約付款驗收簽署繁體中文']) {
  assert.ok(__test.subsetFor(character), `font subset missing for ${character}`);
}

const handler = createEngineeringContractPdfRenderHandler();

{
  const { res } = await invoke(handler, payload(), 'wrong-token-value-that-is-still-long-enough');
  assert.equal(res.statusCode, 401);
  assert.equal(res.json.error.code, 'UNAUTHORIZED');
}

let issued;
{
  const result = await invoke(handler, payload(), TOKEN, 'engineering-contract-render:issued:1');
  issued = result.res.buffer;
  assert.equal(result.handled, true);
  assert.equal(result.res.statusCode, 200);
  assert.equal(result.res.headers['Content-Type'], 'application/pdf');
  assert.equal(issued.subarray(0, 5).toString(), '%PDF-');
  assert.equal(result.res.headers['X-Content-Sha256'], crypto.createHash('sha256').update(issued).digest('hex'));
  assert.equal(Number(result.res.headers['Content-Length']), issued.length);

  const retry = await invoke(handler, payload(), TOKEN, 'engineering-contract-render:issued:1');
  assert.deepEqual(retry.res.buffer, issued, 'idempotent retry must return identical PDF bytes');

  const changed = payload();
  changed.contract.title = '不同合約';
  const conflict = await invoke(handler, changed, TOKEN, 'engineering-contract-render:issued:1');
  assert.equal(conflict.res.statusCode, 409);
  assert.equal(conflict.res.json.error.code, 'IDEMPOTENCY_CONFLICT');
}

let signed;
{
  const result = await invoke(handler, payload('signed_pdf'), TOKEN, 'engineering-contract-render:signed:1');
  signed = result.res.buffer;
  assert.equal(result.res.statusCode, 200);
  assert.equal(signed.subarray(0, 5).toString(), '%PDF-');
  assert.equal(result.res.headers['X-Content-Sha256'], crypto.createHash('sha256').update(signed).digest('hex'));
}

const issuedText = (await extractText(issued)).replace(/\s+/g, '');
assert.match(issuedText, /泥作工程承攬合約/);
assert.match(issuedText, /付款條件/);
assert.match(issuedText, /立約雙方資料/);
assert.match(issuedText, /甲方/);
assert.match(issuedText, /乙方/);
assert.match(issuedText, /範例甲方股份有限公司/);
assert.match(issuedText, /簽約款/);
assert.match(issuedText, /驗收標準/);
assert.match(issuedText, /施工圖A1/);
assert.match(issuedText, /BundleSHA-256/);

const signedText = (await extractText(signed)).replace(/\s+/g, '');
assert.match(signedText, /電子簽署證據/);
assert.match(signedText, /A123456789/);
assert.match(signedText, /臺中市西屯區工程路1號/);
assert.match(signedText, /IP位址/);
assert.match(signedText, /203\.0\.113\.42/);
assert.match(signedText, /簽發時間/);
assert.match(signedText, /LINE送達時間/);
assert.match(signedText, /驗證收件時間/);
assert.match(signedText, /簽署時間/);
assert.match(signedText, /我方確認時間/);
assert.match(signedText, new RegExp('d{64}'.replace('d', 'd')));

console.log('Engineering contract PDF renderer dry-run passed: Bearer auth, idempotency, PDF/hash headers, complete TC subsets, Chinese extraction, and signed evidence.');
