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

const structuredBlocks = pdfTest.contractBodyBlocks(`
  <p>工程合約書</p><p>立合約書人：甲方舊資料；乙方舊資料</p>
  <p>第一條：工程名稱</p><p>舊工程名稱</p>
  <p>第二條：工程地點</p><p>舊工程地址</p>
  <p>第三條：工程範圍</p><p>舊工程範圍</p>
  <p>第四條：工程總價</p><p>舊總價 999 元</p>
  <p>第五條：付款辦法</p><p>舊付款內容</p>
  <p>第六條：工程期限</p><p>舊進場與完工日期</p>
  <p>第七條：機具自備</p><p>第七條標準內容</p>
  <p>第十條：工程驗收</p><p>第十條驗收程序</p>
  <p>第十一條：保固期限與履約保證</p><p>本工程自驗收合格之日起由乙方保固 1 年，因不可抗力或甲方使用不當者不在此限。</p><p>乙方應簽立工程總價 10%（新臺幣 36,000 元整）之履約保證本票，保固期滿且無爭議後返還。</p>
  <p>第十二條：逾期責任</p><p>每逾一日，乙方應按工程總價款 1% 計算違約金，甲方得自工程款中扣除。</p>
  <p>第十三條：工作安全</p><p>第十三條標準內容</p>
  <p>第十七條：其他</p><p>第十七條標準內容</p>
  <p>立合約書人：</p><p>舊版結尾甲乙方資料</p><p>附件一：履約保證本票</p>
`);
const structuredEvents = [];
const structuredWriter = {
  documentBlocks(value) { structuredEvents.push(['blocks', value.map((item) => item.text || '').join('|')]); },
  paragraph(value) { structuredEvents.push(['paragraph', value]); },
  gridTable(title, rows) { structuredEvents.push(['table', title, rows.length]); },
  gridRows(rows) { structuredEvents.push(['grid', rows]); },
};
pdfTest.renderStructuredContractBody(structuredWriter, structuredBlocks, payments, acceptance,
  { currency: 'TWD', amount: 175_000 }, {
    contractAmount: 175_000, workScope: '依施工圖及核准報價單施工', startDate: '2026-09-10',
    completionDate: '2026-10-20', acceptanceDate: '2026-10-22', warrantyMonths: 12,
    performanceBondPercent: 10, performanceBondAmount: 17_500, delayPenaltyPercent: 5,
  });
const structuredText = structuredEvents.flat(3).join('|');
assert.doesNotMatch(structuredText, /舊工程名稱|舊工程地址|舊總價|舊進場|舊版結尾|附件一|36,000|總價款 1%/);
assert.match(structuredText, /依施工圖及核准報價單施工/);
assert.match(structuredText, /TWD 175,000/);
assert.match(structuredText, /2026-09-10/);
assert.match(structuredText, /第七條標準內容/);
assert.match(structuredText, /第十條驗收程序/);
assert.match(structuredText, /第十三條標準內容/);
assert.match(structuredText, /保固 12 個月/);
assert.match(structuredText, /因不可抗力或甲方使用不當者不在此限/);
assert.match(structuredText, /工程總價 10%/);
assert.match(structuredText, /新臺幣 17,500 元整/);
assert.match(structuredText, /工程總價款 5%/);
assert.match(structuredText, /甲方得自工程款中扣除/);

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
