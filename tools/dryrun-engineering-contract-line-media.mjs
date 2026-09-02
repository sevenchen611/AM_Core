import assert from 'node:assert/strict';

import { __test as collectTest } from '../modules/collect/index.js';
import { __test as archiveTest } from '../modules/construction/contract-line-archive.js';

assert.equal(
  collectTest.storedMessageContent({ type: 'sticker', packageId: '789', stickerId: '123456' }),
  '[sticker] package:789 sticker:123456',
);
assert.equal(collectTest.storedMessageContent({ type: 'image' }), '');
assert.equal(archiveTest.stageLabel('historical_supplement'), 'V1 前歷史補充封存');
assert.equal(archiveTest.publicLineArchive({
  id: 'archive-1', version_id: 'version-1', version_no: 1, stage: 'historical_supplement',
  started_after: '2026-08-24T00:00:00.000Z', ended_at: '2026-08-28T00:00:00.000Z',
  message_count: 26, pdf_sha256: 'a'.repeat(64), created_at: '2026-09-02T00:00:00.000Z',
}).fileName, 'V1-V1前歷史補充-LINE對話封存.pdf');

console.log('Engineering contract LINE media dry-run passed: sticker identifiers and historical supplement labels are preserved.');
