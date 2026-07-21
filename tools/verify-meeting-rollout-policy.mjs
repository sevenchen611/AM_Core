import assert from 'node:assert/strict';
import {
  MEETING_ROLLOUT_MODES,
  normalizeMeetingMode,
  resolveMeetingRolloutPolicy,
} from '../modules/meetings/policy.js';

const {
  OFF,
  RECORD_ONLY,
  REVIEW_ONLY,
  REVIEW_AND_CREATE,
} = MEETING_ROLLOUT_MODES;

assert.ok(OFF && RECORD_ONLY && REVIEW_ONLY && REVIEW_AND_CREATE, '四種會議導入模式必須完整定義');
assert.equal(new Set(Object.values(MEETING_ROLLOUT_MODES)).size, 4, '四種會議導入模式不可使用重複值');

const tenant = (formalTasksEnabled) => ({
  key: formalTasksEnabled ? 'formal-on' : 'formal-off',
  modules: ['meetings'],
  config: { meetings: { formalTasksEnabled } },
});
const binding = (overrides = {}) => ({
  id: 'binding-1',
  groupId: 'C_TEST_GROUP',
  status: '啟用',
  capabilities: ['會議'],
  ...overrides,
});
const policy = (requestedMode, { formal = true, binding: bindingOverrides = {} } = {}) => resolveMeetingRolloutPolicy({
  tenant: tenant(formal),
  binding: binding(bindingOverrides),
  ...(requestedMode === undefined ? {} : { requestedMode }),
});

// 舊租戶沒有群組級模式時，必須維持 formalTasksEnabled 的既有行為。
{
  const legacyFull = policy(undefined, { formal: true });
  assert.equal(legacyFull.effectiveMode, REVIEW_AND_CREATE);
  assert.equal(legacyFull.review, true);
  assert.equal(legacyFull.createFormalTasks, true);

  const legacyRecord = policy(undefined, { formal: false });
  assert.equal(legacyRecord.effectiveMode, RECORD_ONLY);
  assert.equal(legacyRecord.record, true);
  assert.equal(legacyRecord.review, false);
  assert.equal(legacyRecord.createFormalTasks, false);

  const legacyEmptyCapability = policy(undefined, { formal: true, binding: { capabilities: [] } });
  assert.equal(legacyEmptyCapability.effectiveMode, REVIEW_AND_CREATE, '舊群組空白啟用功能欄不得在部署時被意外關閉');
}

// 四個模式必須形成單調權限：關閉 → 只記錄 → 試行確認 → 確認並建正式待辦。
for (const [mode, expected] of [
  [OFF, { enabled: false, record: false, review: false, createFormalTasks: false }],
  [RECORD_ONLY, { enabled: true, record: true, review: false, createFormalTasks: false }],
  [REVIEW_ONLY, { enabled: true, record: true, review: true, createFormalTasks: false }],
  [REVIEW_AND_CREATE, { enabled: true, record: true, review: true, createFormalTasks: true }],
]) {
  const actual = policy(mode);
  assert.equal(actual.effectiveMode, mode, `${mode} 不應在已授權租戶被改寫`);
  for (const [field, value] of Object.entries(expected)) {
    assert.equal(actual[field], value, `${mode}.${field}`);
  }
}

// normalize 需接受管理台輸出的合法值；未知值不可靜默變成較高權限模式。
for (const mode of Object.values(MEETING_ROLLOUT_MODES)) assert.equal(normalizeMeetingMode(mode), mode);
assert.equal(normalizeMeetingMode('definitely-not-a-mode'), '', '未知模式應回空值，由呼叫端採安全退路');

// 租戶 formalTasksEnabled 是正式建任務的天花板；群組不能自行越權。
{
  const capped = policy(REVIEW_AND_CREATE, { formal: false });
  assert.equal(capped.effectiveMode, REVIEW_ONLY);
  assert.equal(capped.review, true);
  assert.equal(capped.createFormalTasks, false);
  assert.equal(capped.downgraded, true);
  assert.ok(capped.reasons?.length, '降級必須留下可顯示的原因');
}

// 影子群只能留下會議記錄，不可要求負責人確認或建立正式待辦。
{
  const shadow = policy(REVIEW_AND_CREATE, { binding: { status: '影子記錄' } });
  assert.equal(shadow.effectiveMode, RECORD_ONLY);
  assert.equal(shadow.record, true);
  assert.equal(shadow.review, false);
  assert.equal(shadow.createFormalTasks, false);
  assert.equal(shadow.downgraded, true);
}

// 停用群與未啟用「會議」能力的群組都必須 fail closed。
for (const bindingOverrides of [
  { status: '停用' },
  { capabilities: ['待辦'] },
]) {
  const blocked = policy(REVIEW_AND_CREATE, { binding: bindingOverrides });
  assert.equal(blocked.effectiveMode, OFF);
  assert.equal(blocked.enabled, false);
  assert.equal(blocked.record, false);
  assert.equal(blocked.review, false);
  assert.equal(blocked.createFormalTasks, false);
}

console.log('Meeting rollout policy verification passed: legacy behavior, four modes, tenant ceiling, and shadow/disabled downgrades are safe.');
