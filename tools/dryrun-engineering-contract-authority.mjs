import assert from 'node:assert/strict';
import { resolveAuthoritativeSigningGroup } from '../modules/construction/contract-authority.js';

function page({ projectId = 'project-1', status = '啟用', members = { 王先生: 'U_SIGNER' } } = {}) {
  return {
    id: 'binding-1',
    parent: { data_source_id: 'groups-db' },
    properties: {
      '專案': { relation: [{ id: projectId }] },
      '狀態': { select: { name: status } },
      'LINE 群組 ID': { rich_text: [{ plain_text: 'C_ENGINEERING_GROUP' }] },
      '成員對照': { rich_text: [{ plain_text: JSON.stringify(members) }] },
      '群組名稱': { title: [{ plain_text: '水電工班群' }] },
    },
  };
}

async function resolve(value) {
  return resolveAuthoritativeSigningGroup({
    dataSources: { groupBindings: 'groups-db' },
    notionRequest: async () => value,
  }, { groupBindingId: 'binding-1', projectId: 'project-1', signerLineUserId: 'U_SIGNER' });
}

assert.deepEqual(await resolve(page()), {
  groupBindingId: 'binding-1', lineGroupId: 'C_ENGINEERING_GROUP', signerLineUserId: 'U_SIGNER',
  signerName: '王先生', groupName: '水電工班群',
});
await assert.rejects(() => resolve(page({ projectId: 'other-project' })), /不屬於/);
await assert.rejects(() => resolve(page({ status: '停用' })), /未啟用/);
await assert.rejects(() => resolve(page({ members: { 李先生: 'U_OTHER' } })), /不在.*成員對照/);

console.log('Engineering contract authority dry-run passed: project, active LINE group, and designated member are server-authoritative.');
