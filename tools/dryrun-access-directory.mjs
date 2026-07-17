import assert from 'node:assert/strict';
import { createAccessDirectory } from '../core/access-directory.js';

const rich = (value) => ({ rich_text: [{ plain_text: value }] });
const title = (value) => ({ title: [{ plain_text: value }] });
const select = (value) => ({ select: { name: value } });
const calls = [];
const tenants = [
  {
    key: 'ready', displayName: 'Ready', runtimeEnabled: true, authorizationReady: true, notionConfigured: true,
    dataSources: { groupBindings: 'ready-db' }, config: { portal: { label: 'Ready AM' } },
  },
  {
    key: 'pending', displayName: 'Pending', runtimeEnabled: false, authorizationReady: false, notionConfigured: false,
    dataSources: {}, config: { portal: { featureAliases: ['am-pending'], authorizationNote: '遷移中' } },
  },
  {
    key: 'broken', displayName: 'Broken', runtimeEnabled: true, authorizationReady: true, notionConfigured: true,
    dataSources: { groupBindings: 'broken-db' }, config: { portal: {} },
  },
];

const directory = createAccessDirectory({
  tenants,
  logger: { warn() {} },
  notionRequest: async (pathname, options) => {
    calls.push({ pathname, options });
    if (pathname.includes('broken-db')) throw new Error('simulated outage');
    return {
      results: [{
        id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        properties: {
          '群組名稱': title('群組 A'), '狀態': select('啟用'), '群組角色': select('一般'),
          '主要負責人': rich('Tony'), 'LINE 群組 ID': rich('must-not-leak'), '成員對照': rich('{"secret":true}'),
        },
      }],
      has_more: false,
    };
  },
});

const result = await directory();
const ready = result.tenants.find((tenant) => tenant.key === 'ready');
const pending = result.tenants.find((tenant) => tenant.key === 'pending');
const broken = result.tenants.find((tenant) => tenant.key === 'broken');
assert.equal(ready.assignable, true);
assert.equal(ready.groups.length, 1);
assert.deepEqual(Object.keys(ready.groups[0]).sort(), ['id', 'name', 'owner', 'role', 'status']);
assert.doesNotMatch(JSON.stringify(ready), /must-not-leak|secret/);
assert.equal(pending.assignable, false);
assert.equal(pending.status, 'migration-pending');
assert.equal(pending.featureKey, 'am-pending');
assert.equal(broken.assignable, false);
assert.equal(broken.status, 'temporarily-unavailable');
assert.equal(broken.groups.length, 0);
assert.equal(calls.filter((call) => call.pathname.includes('pending')).length, 0);
assert.ok(calls.every((call) => call.options.tenantKey === (call.pathname.includes('ready') ? 'ready' : 'broken')));

console.log('✅ 可用租戶只回傳授權所需欄位，不洩漏 LINE ID／成員');
console.log('✅ 遷移中租戶可見但不可授權，且不查正式資料');
console.log('✅ 單一租戶目錄故障 fail closed，不拖垮其他租戶');

