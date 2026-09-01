import fs from 'node:fs/promises';
import path from 'node:path';

import { __test as renderer } from '../modules/construction/contract-pdf-renderer.js';

const output = path.resolve(process.argv[2] || 'output/pdf/engineering-contract-layout-preview.pdf');
const hash = (character) => character.repeat(64);
const signature = 'iVBORw0KGgoAAAANSUhEUgAAAUAAAAB4CAYAAACDziveAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAALfSURBVHhe7dtbbtRAGITRrIQdsA32vyMQREhQmotnYrfbXedI9cJLiP/W95aPnwClPvIfAFoIIFBLAIFaAgjUEkCglgACtQQQqCWAQC0BBGoJIFBLAIFaAgjUEkCglgACtQQQqCWAQC0BBGoJIFBLAIFaAgjUEkCglgACtQQQqCWAQC0BBGoJIFBLAIFaAgjUEkCglgACtQQQqCWAQC0BBGoJIFBLAIFaAgjUEkCglgACtQQQqCWAQC0BBKby7cf3PxtBAIEp/A3fvzuaAAKnyeDljiaAwHAZuns7mgACw2Tg7m0UAQQOlXG7tzMIILC7jNujnUkAgd1k3B5tBgIIfEmG7dlmIoDAyzJqzzYrAQQ2yag92xUIIHBXRm3LrkQAN8oj7zGYUb7TLbsqAXzz4GcN9pZvbOtWUBXAPOCKgy3y3WzdapYOYB7PPkeffAOvbGVLBTAPt9eOkj9nhnF9edNX1+TyAczjvbMryf/76DGfvNE7a3XJAObxtq5F/t4jx3HyW39lfLpMAPOAW8Zt+Z1Gj8fye+0xbps+gHnIZ+Nr8nueuVXl73nE2GbaAOZB742x8vtfYUfIn3HmeN90Aczj3htzyjvZfmN/0wQwj31rrCHvav+PcU4PYB7/1uiU72CVMY/TApiP4tZgD/mu9hhrOCWA+ZhyACMMDWCGLgcw0pAAZuhyAGc4PIAZO+EDZnFoADN44gfM5JAAZuyED5jR7gHM4IkfMKshAQSY0e4B/E38gCs4NIAAMzskgABXIIBALQEEagkgUEsAgVoCCNQSQKCWAAK1BBCoVRPA/PtkM3t/qxBAM3t5qxBAM3t5qxBAM3t5q6gJIEASQKCWAAK1BBCoJYBALQEEagkgUEsAgVoCCNQSQKCWAAK1BBCoJYBALQEEagkgUEsAgVoCCNQSQKCWAAK1BBCoJYBALQEEagkgUEsAgVoCCNQSQKCWAAK1BBCoJYBALQEEav0CkXwV4lsMFUAAAAAASUVORK5CYII=';

const payload = renderer.validatePayload({
  kind: 'signed_pdf',
  contract: {
    id: 'layout-preview', contractNumber: 'HZ-CT-001', title: '工程合約書',
    projectCode: 'HZ', trade: '拆除', amount: 360000, currency: 'TWD',
    partyACompany: '甲方股份有限公司', partyATaxId: '12345678',
    partyAResponsiblePerson: '甲方負責人', partyARepresentative: '甲方代表人',
    partyAIdentityNumber: 'A123456789', partyAAddress: '臺中市西區甲方路 1 號',
    counterpartyCompany: '乙方工程行', counterpartyTaxId: '87654321',
    counterpartyResponsiblePerson: '乙方負責人', counterpartyName: '乙方簽約人',
  },
  version: {
    id: 'layout-preview-v1', versionNo: 1, frozenAt: '2026-09-01T01:00:00.000Z',
    attachmentManifestHash: hash('d'),
    snapshot: { documentPackage: {
      contractBody: { name: '工程合約書.docx', fileId: 'body-preview', sha256: hash('a') },
      constructionDrawings: [{ name: '施工圖 A1.pdf', fileId: 'drawing-preview', sha256: hash('b'), revision: 'A1' }],
      quotation: { name: '核定報價單.pdf', fileId: 'quote-preview', sha256: hash('c') },
      paymentMilestones: [
        { label: '第一期款', percentage: 30, amount: 108000, dueDate: '2026-09-15', dueTime: '17:00', trigger: '配管配線完成並提出合法發票' },
        { label: '第二期款', percentage: 30, amount: 108000, dueDate: '2026-10-06', dueTime: '17:00', trigger: '燈具安裝完成並經甲方初驗合格' },
        { label: '第三期款', percentage: 30, amount: 108000, dueDate: '2026-10-31', dueTime: '17:00', trigger: '設備安裝完成並經甲方驗收合格' },
        { label: '尾款', percentage: 10, amount: 36000, dueDate: '', dueTime: '', trigger: '完工交付二週且無工程缺失' },
      ],
      acceptanceCriteria: [
        { criterion: '施工品質與規格', reference: '合約、施工圖及報價單', verificationMethod: '現場逐項查驗', passCondition: '項目及數量均符合約定', evidenceRequired: '工程驗收單' },
        { criterion: '缺失改善', reference: '驗收缺失清單', verificationMethod: '完成改善後複驗', passCondition: '所有缺失均完成', evidenceRequired: '複驗紀錄與照片' },
      ],
    } },
  },
  contractBodyText: '工程合約本文',
  contractBodyHtml: '<h1>工程合約書</h1><p>立合約書人：</p><table><tr><td>當事人</td><td>甲方</td><td>乙方</td></tr><tr><td>公司／姓名</td><td>甲方股份有限公司</td><td>乙方工程行</td></tr><tr><td>代表人</td><td>甲方代表人</td><td>乙方簽約人</td></tr><tr><td>地址</td><td>臺中市西區甲方路 1 號</td><td>臺中市西屯區工程路 1 號</td></tr></table><h2>第一條：工程名稱</h2><p>本工程名稱及工作範圍依本合約、施工圖與報價單辦理。</p><h2>第二條：付款辦法</h2><p>乙方依約請款時應檢附合法發票，甲方依下列付款表辦理。</p>',
  immutable: true,
  bundleHash: hash('d'), documentHash: hash('e'), ipAddress: '203.0.113.42',
  counterpartyDetails: {
    name: '乙方簽約人', identityNumber: 'B123456789', address: '臺中市西屯區工程路 1 號',
  },
  signature: { mimeType: 'image/png', base64: signature, sha256: hash('f') },
  times: {
    issuedAt: '2026-09-01T01:00:00.000Z', sentAt: '2026-09-01T01:01:00.000Z',
    receivedAt: '2026-09-01T01:03:00.000Z', signedAt: '2026-09-01T01:05:00.000Z',
    confirmedAt: '2026-09-01T01:07:00.000Z',
  },
  verification: {
    identityDocumentsVerified: true,
    identityDocumentHashes: { front: hash('1'), back: hash('2') },
    identityDocumentsReceivedAt: { front: '2026-09-01T01:04:00.000Z', back: '2026-09-01T01:04:30.000Z' },
  },
});

const buffer = await renderer.renderContractPdf(payload);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, buffer);
console.log(output);
