// AM Platform core — LINE group onboarding commands.
// Command examples:
//   綁定 Forest 群組：營運群
//   綁定 Green Hotel AM 群組：營運群
//   綁定 HOZO AM 2.0 群組：營運處 VS 好住寓好

import { textItem } from './util.js';

export const GROUP_ONBOARDING_BUILD = 'calendar-binding-token-parser-2026-08-07';
export const LEGACY_HOZO20_BIND_COMMAND = '<绑定 HOZOAM 2.0 群组>';

export const ONBOARDING_TENANTS = [
  {
    key: 'forest',
    label: 'Forest',
    aliases: ['forest', 'forest am', '森在', '森在 am'],
    defaultStatus: '影子記錄',
    defaultCapabilities: ['訊息收集', '會議', '照片'],
    purpose: (name) => `Forest AM「${name}」群組；先以影子模式保留來源訊息、圖片與會議，待驗證後再開正式控制。`,
    statusUpdatePolicy: '主要負責人',
  },
  {
    key: 'green-hotel',
    label: 'Green Hotel AM',
    aliases: ['green hotel am', 'green hotel', 'green', '葉綠宿 am', '葉綠宿'],
    defaultStatus: '影子記錄',
    defaultCapabilities: ['訊息收集', '會議', '照片'],
    purpose: (name) => `Green Hotel AM「${name}」群組；先以影子模式保留來源訊息、圖片與會議，待驗證後再開正式控制。`,
    statusUpdatePolicy: '總管',
  },
  {
    key: 'hozo-am-2-0',
    label: 'HOZO AM 2.0',
    aliases: ['hozo am 2.0', 'hozoam 2.0', 'hozo am 2 0', 'hozoam 2 0', 'hz2'],
    defaultStatus: '啟用',
    defaultCapabilities: ['訊息收集', '待辦', '會議', '案件狀態', '照片', '提醒'],
    defaultMeetingMode: '完整確認',
    purpose: (name) => `HOZO AM 2.0「${name}」群組；正式開放訊息收集、待辦建立、會議待辦確認、案件狀態更新、照片附件與提醒工作流。`,
    statusUpdatePolicy: '總管',
  },
];

const normalizedAlias = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/\s+/g, ' ');

export function normalizeGroupOnboardingText(value) {
  return String(value || '')
    .trim()
    .replace(/[＜]/g, '<')
    .replace(/[＞]/g, '>')
    .replace(/[：]/g, ':')
    .replace(/\s+/g, ' ');
}

function tenantConfigByAlias(value) {
  const needle = normalizedAlias(value);
  return ONBOARDING_TENANTS.find((tenant) => tenant.aliases.some((alias) => normalizedAlias(alias) === needle)) || null;
}

export function supportedGroupOnboardingExamples() {
  return [
    '綁定 Forest 群組：<群組名稱>',
    '綁定 Green Hotel AM 群組：<群組名稱>',
    '綁定 HOZO AM 2.0 群組：<群組名稱>',
  ];
}

export function parseGroupOnboardingCommand(value) {
  const text = normalizeGroupOnboardingText(value);
  if (!text) return { isCommand: false };

  if (text === LEGACY_HOZO20_BIND_COMMAND) {
    return {
      isCommand: true,
      tenantKey: 'hozo-am-2-0',
      tenantLabel: 'HOZO AM 2.0',
      groupName: '',
      requiresLineGroupName: true,
      sourceCommand: text,
      legacy: true,
    };
  }

  const match = text.match(/^(綁定|绑定)\s+(.+?)\s*(群組|群组)\s*:\s*(.+)$/i);
  if (!match) {
    return /^(綁定|绑定)(\s|$)/i.test(text)
      ? { isCommand: true, error: '格式不完整，請指定 AM 租戶與群組名稱。', sourceCommand: text }
      : { isCommand: false };
  }

  const config = tenantConfigByAlias(match[2]);
  const groupName = String(match[4] || '').trim();
  if (!config) {
    return { isCommand: true, error: `不支援的 AM 租戶：「${match[2]}」。`, sourceCommand: text };
  }
  if (!groupName) {
    return { isCommand: true, error: '缺少群組名稱。', sourceCommand: text };
  }
  if (groupName.length > 120) {
    return { isCommand: true, error: '群組名稱太長，請控制在 120 字以內。', sourceCommand: text };
  }

  return {
    isCommand: true,
    tenantKey: config.key,
    tenantLabel: config.label,
    groupName,
    sourceCommand: text,
  };
}

// 群組 ID 才是實際綁定鍵；名稱只供管理者辨識，應以 LINE 當下回傳的群名為準。
export function withResolvedGroupName(command, lineGroupName) {
  const resolvedName = String(lineGroupName || '').trim() || String(command?.groupName || '').trim();
  if (!resolvedName) {
    throw new Error('無法讀取目前 LINE 群組名稱，請確認葉小蝸仍在群組內後再發送綁定指令。');
  }
  return { ...command, groupName: resolvedName };
}

export function groupOnboardingProperties(command, groupId, { projectPageId = '', schema = null } = {}) {
  const config = ONBOARDING_TENANTS.find((tenant) => tenant.key === command.tenantKey);
  if (!config) throw new Error(`Unsupported onboarding tenant: ${command.tenantKey}`);
  const has = (name) => !schema || Boolean(schema.properties?.[name]);
  const status = config.defaultStatus || '影子記錄';
  const capabilities = config.defaultCapabilities || ['訊息收集', '會議', '照片'];
  const properties = {
    '群組名稱': { title: [textItem(command.groupName)] },
    'LINE 群組 ID': { rich_text: [textItem(groupId)] },
    '群組角色': { select: { name: '內部' } },
    '工種': { select: { name: '營運' } },
    '狀態': { select: { name: status } },
    '成員對照': { rich_text: [textItem('{}')] },
    '群組用途': { rich_text: [textItem(config.purpose(command.groupName))] },
    '主要負責人': { rich_text: [] },
    '啟用功能': { multi_select: capabilities.map((name) => ({ name })) },
    '會議待辦模式': { select: { name: config.defaultMeetingMode || '僅記錄' } },
    '所屬目標': { rich_text: [textItem(command.groupName)] },
    '狀態更新權限': { select: { name: config.statusUpdatePolicy } },
    '預設提醒對象': { rich_text: [] },
    '最後設定時間': { date: { start: new Date().toISOString() } },
    '最後設定者': { rich_text: [textItem(`LINE onboarding: ${command.sourceCommand}`)] },
  };
  if (projectPageId) properties['專案'] = { relation: [{ id: projectPageId }] };

  const filtered = {};
  for (const [name, value] of Object.entries(properties)) {
    if (has(name)) filtered[name] = value;
  }
  for (const required of ['群組名稱', 'LINE 群組 ID', '狀態']) {
    if (!filtered[required]) throw new Error(`群組綁定資料源缺少必要欄位「${required}」。`);
  }
  return filtered;
}

// 同一個 groupId 已屬於同一租戶時，只校正容易被舊口令寫錯的辨識資料，
// 不重設管理者後續在群組後台調整過的狀態、功能或專案關聯。
export function groupOnboardingRepairProperties(command, groupId, { schema = null } = {}) {
  const config = ONBOARDING_TENANTS.find((tenant) => tenant.key === command.tenantKey);
  if (!config) throw new Error(`Unsupported onboarding tenant: ${command.tenantKey}`);
  const has = (name) => !schema || Boolean(schema.properties?.[name]);
  const properties = {
    '群組名稱': { title: [textItem(command.groupName)] },
    'LINE 群組 ID': { rich_text: [textItem(groupId)] },
    '群組用途': { rich_text: [textItem(config.purpose(command.groupName))] },
    '所屬目標': { rich_text: [textItem(command.groupName)] },
    '最後設定時間': { date: { start: new Date().toISOString() } },
    '最後設定者': { rich_text: [textItem(`LINE onboarding repair: ${command.sourceCommand}`)] },
  };
  return Object.fromEntries(Object.entries(properties).filter(([name]) => has(name)));
}
