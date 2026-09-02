import assert from 'node:assert/strict';

import { __test as pdfTest } from '../modules/construction/contract-pdf-renderer.js';
import { validateContractPackage } from '../modules/construction/contract-domain.js';

const blocks = pdfTest.contractBodyBlocks(`
  <p>第四條：工程總價</p><p>本工程總價依報價單。</p>
  <p>第五條：付款辦法</p><p>第一期款：舊付款內容 100,000 元。</p>
  <p>乙方依約請款時應檢附合法發票，甲方於收到發票後十日內付款。</p>
  <p>第六條：工程期限</p><p>依現場進度辦理。</p>
  <p>第十條：工程驗收</p><p>驗收程序：甲方會同乙方現場查驗。</p>
  <p>缺失改善與複驗：乙方應於期限內改善。</p>
  <p>第十一條：保固期限</p><p>保固一年。</p>
`);
const events = [];
const writer = {
  documentBlocks(value) { events.push(['blocks', value.map((item) => item.text || '').join('|')]); },
  paragraph(value) { events.push(['paragraph', value]); },
  gridTable(title, rows) { events.push(['table', title, rows.length]); },
};
const payments = [
  { label: '第一期', percentage: 50, amount: 50_000, trigger: '完成拆除' },
  { label: '第二期', percentage: 50, amount: 50_000, trigger: '驗收完成' },
];
const acceptance = [{ criterion: '拆除面清潔', passCondition: '無殘留物' }];
const result = pdfTest.renderStructuredContractBody(writer, blocks, payments, acceptance, { currency: 'TWD' });
assert.deepEqual(result, { paymentRendered: true, acceptanceRendered: true });
assert.equal(events.filter((event) => event[0] === 'table' && event[1] === '付款條件表').length, 1);
assert.equal(events.filter((event) => event[0] === 'table' && event[1] === '專案驗收標準表').length, 1);
assert.equal(events.some((event) => String(event[1]).includes('舊付款內容')), false, 'old Word schedule must be suppressed');
assert.equal(events.some((event) => String(event[1]).includes('合法發票')), true, 'general invoice clause must remain');
const acceptanceTable = events.findIndex((event) => event[0] === 'table' && event[1] === '專案驗收標準表');
const articleEleven = events.findIndex((event) => String(event[1]).includes('第十一條'));
assert.ok(acceptanceTable >= 0 && acceptanceTable < articleEleven, 'acceptance table must be embedded before article eleven');

assert.deepEqual(pdfTest.historicalAttachmentRows({ attachments: [
  { name: 'V1 舊報價.pdf', inherited: true, sourceVersionNo: 1, sha256: 'a'.repeat(64) },
  { name: '本版一般附件.pdf', inherited: false },
]}).map((item) => item.name), ['V1 舊報價.pdf']);

const normalized = validateContractPackage({ acceptanceCriteria: [{
  criterion: '拆除面清潔', reference: '施工圖 A-01', verificationMethod: '現場查驗',
  passCondition: '無殘留物', evidenceRequired: '驗收照片',
}] });
assert.deepEqual(normalized.acceptanceCriteria[0], {
  id: 'acceptance-001', criterion: '拆除面清潔', reference: '施工圖 A-01', verificationMethod: '現場查驗',
  passCondition: '無殘留物', evidenceRequired: '驗收照片', verifier: '',
});

console.log('Engineering contract structured-body dry-run passed: one payment source, embedded acceptance table, retained legal clauses, and historical index verified.');
