import assert from 'node:assert/strict';
import {
  CONTRACT_CONTROL_CENTER_DETAIL_PATH,
  CONTRACT_CONTROL_CENTER_REFRESH_MS,
  CONTRACT_CONTROL_CENTER_SUMMARY_PATH,
  contractControlCenterClientScript,
  renderContractControlCenter,
  renderContractControlCenterMarkup,
} from '../modules/construction/contract-control-center-web.js';

const markup = renderContractControlCenterMarkup({ rootId: 'contract-control-test' });
assert.match(markup, /data-contract-control-queues/);
assert.match(markup, /data-contract-control-drawer/);
assert.match(markup, /role="dialog"/);

const script = contractControlCenterClientScript({ tenantKey: 'engineering', apiKey: 'test-key' });
assert.match(script, new RegExp(CONTRACT_CONTROL_CENTER_SUMMARY_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.match(script, /\/contracts\/api\/v2\/contracts\/:contractId\/control/);
assert.match(script, new RegExp(String(CONTRACT_CONTROL_CENTER_REFRESH_MS)));
assert.match(script, /window\.addEventListener\('focus'/);
assert.match(script, /window\.setInterval/);
assert.match(script, /textContent/);
assert.match(script, /待簽署/);
assert.match(script, /待我方確認/);
assert.match(script, /付款管理/);
assert.match(script, /驗收管理/);
assert.match(script, /資料異常/);
assert.match(script, /甲方簽署狀態/);
assert.match(script, /乙方簽署狀態/);
assert.doesNotMatch(script, /state_snapshot|snapshot/);
assert.match(script, /AMContractControlCenter/);

const combined = renderContractControlCenter({ rootId: 'contract-control-test' });
assert.match(combined, /<script>/);
assert.match(combined, /contract-control-test/);
assert.equal(CONTRACT_CONTROL_CENTER_DETAIL_PATH, '/contracts/api/v2/contracts/:contractId/control');

console.log('dryrun-engineering-contract-control-web: OK');
