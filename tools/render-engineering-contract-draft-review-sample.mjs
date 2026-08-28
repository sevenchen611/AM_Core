import fs from 'node:fs/promises';
import path from 'node:path';

import { __test as renderer } from '../modules/construction/contract-pdf-renderer.js';

const output = path.resolve(process.argv[2] || 'output/pdf/engineering-contract-draft-review-sample.pdf');
const contractBodyText = Array.from({ length: 4 }, (_, copy) => `
工程合約書草約內容測試 ${copy + 1}
第一條：工程名稱與工程地點待雙方確認。
第二條：工程範圍依圖說、施工規範與報價單辦理。
第三條：材料規格與工程變更，須經雙方書面確認後始得辦理。
第四條：工程完成後，依雙方最後正式簽署版本所載標準辦理驗收。
第五條：本草約僅供討論，不是正式簽署版本。
`).join('\n');

const payload = renderer.validatePayload({
  kind: 'draft_review_pdf',
  contract: {
    id: 'sample-contract', contractNumber: 'HZ-CT-001', title: '拆除合約',
    projectCode: 'HZ', trade: '拆除', counterpartyName: '待確認', amount: null, currency: 'TWD',
  },
  version: {
    id: 'sample-version', versionNo: 1, status: 'draft', createdAt: '2026-08-28T12:00:00.000Z',
    snapshot: { documentPackage: {
      contractBody: { name: '工程合約書草約.docx', category: 'contract_body', sha256: '1'.repeat(64) },
      constructionDrawings: [{ name: '拆除施工圖.pdf', category: 'construction_drawing', sha256: '2'.repeat(64) }],
      quotation: { name: '拆除報價單.pdf', category: 'quotation', sha256: '3'.repeat(64) },
      paymentMilestones: [], acceptanceCriteria: [],
    } },
  },
  contractBodyText,
  missingSections: ['付款條件', '驗收標準'],
});

const buffer = await renderer.renderContractPdf(payload);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, buffer);
console.log(output);
