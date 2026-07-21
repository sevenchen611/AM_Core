// AM Platform meetings — per-tenant / per-group rollout policy.
//
// The value stored on a group binding is the administrator's requested mode.
// Runtime code must always use resolveMeetingRolloutPolicy().effectiveMode: the
// tenant ceiling and a shadow/disabled binding may safely reduce that request.

export const MEETING_POLICY_VERSION = 'AM-MEETING-POLICY-2026.0721.01';

export const MEETING_ROLLOUT_MODES = Object.freeze({
  OFF: 'off',
  RECORD_ONLY: 'record_only',
  REVIEW_ONLY: 'review_only',
  REVIEW_AND_CREATE: 'review_and_create',
});

export const MEETING_MODE_OPTIONS = Object.freeze([
  Object.freeze({ value: MEETING_ROLLOUT_MODES.OFF, label: '關閉', level: 0 }),
  Object.freeze({ value: MEETING_ROLLOUT_MODES.RECORD_ONLY, label: '僅記錄', level: 1 }),
  Object.freeze({ value: MEETING_ROLLOUT_MODES.REVIEW_ONLY, label: '確認試行', level: 2 }),
  Object.freeze({ value: MEETING_ROLLOUT_MODES.REVIEW_AND_CREATE, label: '完整確認', level: 3 }),
]);

const MODE_LEVEL = new Map(MEETING_MODE_OPTIONS.map((option) => [option.value, option.level]));
const MODE_LABEL = new Map(MEETING_MODE_OPTIONS.map((option) => [option.value, option.label]));
const MODE_ALIASES = new Map([
  ...MEETING_MODE_OPTIONS.flatMap((option) => [
    [option.value, option.value],
    [option.label, option.value],
  ]),
  ['disabled', MEETING_ROLLOUT_MODES.OFF],
  ['disable', MEETING_ROLLOUT_MODES.OFF],
  ['none', MEETING_ROLLOUT_MODES.OFF],
  ['停用', MEETING_ROLLOUT_MODES.OFF],
  ['關閉會議功能', MEETING_ROLLOUT_MODES.OFF],
  ['record', MEETING_ROLLOUT_MODES.RECORD_ONLY],
  ['record-only', MEETING_ROLLOUT_MODES.RECORD_ONLY],
  ['只產生會議記錄', MEETING_ROLLOUT_MODES.RECORD_ONLY],
  ['僅產生會議記錄', MEETING_ROLLOUT_MODES.RECORD_ONLY],
  ['review', MEETING_ROLLOUT_MODES.REVIEW_ONLY],
  ['review-only', MEETING_ROLLOUT_MODES.REVIEW_ONLY],
  ['待辦確認試行', MEETING_ROLLOUT_MODES.REVIEW_ONLY],
  ['確認試行，不建立正式任務', MEETING_ROLLOUT_MODES.REVIEW_ONLY],
  ['full', MEETING_ROLLOUT_MODES.REVIEW_AND_CREATE],
  ['review-and-create', MEETING_ROLLOUT_MODES.REVIEW_AND_CREATE],
  ['完整確認並建立正式任務', MEETING_ROLLOUT_MODES.REVIEW_AND_CREATE],
]);

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const tenantMeetingsDisabled = (tenant) => tenant?.runtimeEnabled === false
  || (Array.isArray(tenant?.modules) && !tenant.modules.includes('meetings'));

export function normalizeMeetingMode(value, fallback = '') {
  const raw = clean(value);
  if (!raw) return fallback;
  return MODE_ALIASES.get(raw) || MODE_ALIASES.get(raw.toLowerCase()) || fallback;
}

export function meetingModeLabel(mode) {
  return MODE_LABEL.get(normalizeMeetingMode(mode)) || '未設定';
}

export function meetingModeLevel(mode) {
  return MODE_LEVEL.get(normalizeMeetingMode(mode)) ?? -1;
}

export function clampMeetingMode(mode, ceiling) {
  const normalized = normalizeMeetingMode(mode, MEETING_ROLLOUT_MODES.OFF);
  const max = normalizeMeetingMode(ceiling, MEETING_ROLLOUT_MODES.OFF);
  if (meetingModeLevel(normalized) <= meetingModeLevel(max)) return normalized;
  return max;
}

export function isShadowMeetingBinding(binding) {
  const status = clean(binding?.status || binding?.bindingStatus);
  return status === '影子記錄' || lower(status) === 'shadow';
}

function bindingHasMeetingCapability(binding) {
  const capabilities = binding?.capabilities;
  // Older group-binding rows did not have the capability field. An absent
  // field (or an old empty field with no explicit meeting mode) must preserve
  // legacy behaviour rather than disabling a workflow that was already live.
  // Once the management page stores an explicit mode, capabilities becomes a
  // real enforcement input and can safely fail closed.
  if (!Array.isArray(capabilities) || (!capabilities.length && !configuredMode(binding))) return true;
  return capabilities.includes('會議') || capabilities.includes('meetings');
}

function configuredMode(binding) {
  return normalizeMeetingMode(
    binding?.meetingMode
      || binding?.meetingTaskMode
      || binding?.['會議待辦模式']
      || '',
  );
}

// Compatibility for group rows created before the per-group mode existed.
// formalTasksEnabled=true preserves the old full task workflow; false preserves
// the old record/candidate-only workflow. An explicit group mode always wins as
// the requested value, but never bypasses the tenant ceiling below.
export function legacyMeetingMode(tenant, binding = {}) {
  if (tenantMeetingsDisabled(tenant)) {
    return MEETING_ROLLOUT_MODES.OFF;
  }
  const status = clean(binding?.status || binding?.bindingStatus);
  if (status === '停用' || lower(status) === 'disabled') return MEETING_ROLLOUT_MODES.OFF;
  if (!bindingHasMeetingCapability(binding)) return MEETING_ROLLOUT_MODES.OFF;
  return tenant?.config?.meetings?.formalTasksEnabled === true
    ? MEETING_ROLLOUT_MODES.REVIEW_AND_CREATE
    : MEETING_ROLLOUT_MODES.RECORD_ONLY;
}

// formalTasksEnabled remains the compatibility ceiling until a tenant opts in
// to a more explicit modeCeiling / rolloutCeiling. A tenant that has not enabled
// formal task writes may still trial review, but cannot create formal tasks.
export function tenantMeetingModeCeiling(tenant) {
  if (tenantMeetingsDisabled(tenant)) {
    return MEETING_ROLLOUT_MODES.OFF;
  }
  const cfg = tenant?.config?.meetings || {};
  const explicit = normalizeMeetingMode(cfg.modeCeiling || cfg.rolloutCeiling || cfg.maxMode || '');
  if (explicit) return explicit;
  return cfg.formalTasksEnabled === true
    ? MEETING_ROLLOUT_MODES.REVIEW_AND_CREATE
    : MEETING_ROLLOUT_MODES.REVIEW_ONLY;
}

export function resolveMeetingRolloutPolicy({ tenant, binding = {}, requestedMode } = {}) {
  const reasons = [];
  const explicit = normalizeMeetingMode(
    requestedMode === undefined ? configuredMode(binding) : requestedMode,
  );
  const requested = explicit || legacyMeetingMode(tenant, binding);
  let effective = requested;

  if (tenantMeetingsDisabled(tenant)) {
    effective = MEETING_ROLLOUT_MODES.OFF;
    reasons.push('tenant_meetings_disabled');
  }

  const status = clean(binding?.status || binding?.bindingStatus);
  if (status === '停用' || lower(status) === 'disabled') {
    effective = MEETING_ROLLOUT_MODES.OFF;
    reasons.push('binding_disabled');
  }
  if (!bindingHasMeetingCapability(binding)) {
    effective = MEETING_ROLLOUT_MODES.OFF;
    reasons.push('meeting_capability_disabled');
  }

  const ceiling = tenantMeetingModeCeiling(tenant);
  const ceilingClamped = clampMeetingMode(effective, ceiling);
  if (ceilingClamped !== effective) {
    effective = ceilingClamped;
    reasons.push('tenant_ceiling');
  }

  // Shadow groups may retain audio/meeting evidence and candidates, but may not
  // initiate identity review or create formal tasks/external commitments.
  if (isShadowMeetingBinding(binding)) {
    const shadowClamped = clampMeetingMode(effective, MEETING_ROLLOUT_MODES.RECORD_ONLY);
    if (shadowClamped !== effective) {
      effective = shadowClamped;
      reasons.push('shadow_binding');
    }
  }

  const enabled = effective !== MEETING_ROLLOUT_MODES.OFF;
  const review = meetingModeLevel(effective) >= meetingModeLevel(MEETING_ROLLOUT_MODES.REVIEW_ONLY);
  const createFormalTasks = effective === MEETING_ROLLOUT_MODES.REVIEW_AND_CREATE;
  return Object.freeze({
    requestedMode: requested,
    requestedLabel: meetingModeLabel(requested),
    effectiveMode: effective,
    effectiveLabel: meetingModeLabel(effective),
    ceiling,
    ceilingLabel: meetingModeLabel(ceiling),
    enabled,
    record: enabled,
    review,
    createFormalTasks,
    downgraded: requested !== effective,
    reason: reasons[0] || '',
    reasons: Object.freeze(reasons),
    legacy: !explicit,
  });
}

export const __test = {
  bindingHasMeetingCapability,
  configuredMode,
  tenantMeetingsDisabled,
};
