import fs from 'node:fs/promises';
import path from 'node:path';

import { __test as pdfTest } from '../modules/construction/contract-pdf-renderer.js';

const output = path.resolve(process.argv[2] || 'tmp/pdfs/engineering-contract-structured-qa.pdf');
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const now = '2026-09-02T02:00:00.000Z';
const body = Array.from({ length: 17 }, (_, index) => {
  const number = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七'][index];
  const title = ['工程名稱', '工程地點', '工程範圍', '工程總價', '付款辦法', '工程期限', '機具自備', '工程解釋', '材料規格與工程變更', '工程驗收', '保固期限與履約保證', '逾期責任', '工作安全與廢棄物清理', '工人雇用', '不可抗力條款', '合約終止與解約', '其他'][index];
  return `<p>第${number}條：${title}</p><p>這是第${number}條的標準條文內容，用於確認換行、分頁與條文版面。雙方應依本合約、施工圖、報價單及書面確認事項辦理。</p>`;
}).join('');

const payload = {
  kind: 'signed_pdf',
  contract: { id: 'qa-contract', contractNumber: 'QA-CT-001', title: '室內拆除工程合約', amount: 175000, currency: 'TWD' },
  version: {
    versionNo: 12,
    createdAt: now,
    documentPackage: {
      contractFields: {
        trade: '拆除工程', counterpartyName: '測試承攬商', projectName: '測試工程專案', projectAddress: '測試市測試區一號',
        contractAmount: 175000, workScope: '依核准施工圖與報價單完成室內拆除、清運及現場整理。',
        partyAOrganization: '測試甲方股份有限公司', partyATaxId: '12345678', partyAResponsiblePerson: '甲方負責人',
        partyARepresentative: '甲方代表', partyAAddress: '測試市甲方路一號', partyBOrganization: '測試乙方工程行',
        partyBTaxId: '87654321', partyBResponsiblePerson: '乙方負責人', partyBRepresentative: '乙方簽約人',
        partyBIdentityNumber: 'A123456789', partyBAddress: '測試市乙方路二號', startDate: '2026-09-10', completionDate: '2026-10-20',
        acceptanceDate: '2026-10-22', warrantyMonths: 12, performanceBondPercent: 10, performanceBondAmount: 17500,
        promissoryNoteDueDate: '2027-10-22', delayPenaltyPercent: 5, signingDate: '2026-09-08',
      },
      paymentMilestones: [
        { label: '第一期', percentage: 30, amount: 52500, dueDate: '2026-09-15', trigger: '進場及防護完成' },
        { label: '第二期', percentage: 50, amount: 87500, dueDate: '2026-10-10', trigger: '主要拆除及清運完成' },
        { label: '尾款', percentage: 20, amount: 35000, dueDate: '2026-10-29', trigger: '驗收合格且無缺失' },
      ],
      acceptanceCriteria: [
        { criterion: '拆除範圍', reference: '施工圖 A-01', verificationMethod: '現場逐項查驗', passCondition: '範圍及尺寸相符', evidenceRequired: '驗收照片' },
        { criterion: '現場清運', reference: '報價工項 3', verificationMethod: '目視及點收', passCondition: '無廢棄物殘留', evidenceRequired: '完工照片' },
      ],
    },
  },
  contractBodyHtml: `<p>工程合約書</p><p>立合約書人：甲方舊資料；乙方舊資料</p>${body}<p>立合約書人：</p><p>舊版簽約資料</p><p>附件一：履約保證本票</p>`,
  bundleHash: 'b'.repeat(64), documentHash: 'd'.repeat(64), ipAddress: '203.0.113.10', confirmedBy: '甲方確認人',
  times: { issuedAt: now, sentAt: now, receivedAt: now, signedAt: now, confirmedAt: now },
  counterpartyDetails: { name: '乙方簽約人', identityNumber: 'A123456789', address: '測試市乙方路二號' },
  signature: { base64: pixel, sha256: 's'.repeat(64) },
  identityDocuments: {
    front: { base64: pixel, sha256: 'f'.repeat(64), receivedAt: now },
    back: { base64: pixel, sha256: 'e'.repeat(64), receivedAt: now },
  },
  verification: {
    identityDocumentsVerified: true,
    identityDocumentHashes: { front: 'f'.repeat(64), back: 'e'.repeat(64) },
    identityDocumentsReceivedAt: { front: now, back: now },
  },
};

const buffer = await pdfTest.renderContractPdf(payload);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, buffer);
console.log(output);
