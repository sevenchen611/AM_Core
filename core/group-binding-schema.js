// AM Platform — 群組綁定 v2 的跨租戶欄位契約。
// 不含任何租戶資料、Notion ID 或人名；可安全套用至每個租戶自己的群組綁定 data source。

export const GROUP_CAPABILITIES = ['訊息收集', '待辦', '會議', '案件狀態', '照片', '提醒', '請款'];
export const GROUP_STATUS_UPDATE_POLICIES = ['所有成員', '主要負責人', '總管'];
export const GROUP_BINDING_STATUSES = ['啟用', '影子記錄', '停用'];
// 請款的送件資格一律以既有「成員對照」中的 LINE user ID 判斷。
// 顯示名稱僅供後臺選單顯示，不可作為授權依據。
export const GROUP_CLAIM_SUBMISSION_POLICIES = ['停用', '指定成員'];
export const GROUP_BINDING_V2_REQUIRED_FIELDS = [
  '群組用途', '主要負責人', '啟用功能', '所屬目標',
  '狀態更新權限', '預設提醒對象', '最後設定時間', '最後設定者',
];
export const GROUP_BINDING_CLAIMS_REQUIRED_FIELDS = ['請款送件權限', '請款指定送件人'];

export const GROUP_BINDING_V2_PROPERTIES = {
  '狀態': { select: { options: GROUP_BINDING_STATUSES.map((name) => ({ name })) } },
  '群組用途': { rich_text: {} },
  '主要負責人': { rich_text: {} },
  '啟用功能': { multi_select: { options: GROUP_CAPABILITIES.map((name) => ({ name })) } },
  '所屬目標': { rich_text: {} },
  '狀態更新權限': { select: { options: GROUP_STATUS_UPDATE_POLICIES.map((name) => ({ name })) } },
  '預設提醒對象': { rich_text: {} },
  '最後設定時間': { date: {} },
  '最後設定者': { rich_text: {} },
  '請款送件權限': { select: { options: GROUP_CLAIM_SUBMISSION_POLICIES.map((name) => ({ name })) } },
  // JSON encoded LINE user ID array, for example: ["Uxxxxxxxx"].
  '請款指定送件人': { rich_text: {} },
};

// 僅補缺欄位／缺少的 select 選項。型別不符時拒絕覆寫，避免把既有營運資料轉型。
export function groupBindingV2SchemaPatch(existingProperties = {}) {
  const patch = {};
  for (const [name, definition] of Object.entries(GROUP_BINDING_V2_PROPERTIES)) {
    const existing = existingProperties[name];
    if (!existing) {
      patch[name] = definition;
      continue;
    }
    const type = Object.keys(definition)[0];
    if (existing.type && existing.type !== type) {
      throw new Error(`群組綁定欄位「${name}」型別為 ${existing.type}，預期為 ${type}；請人工確認，工具不會覆寫。`);
    }
    if (type !== 'select' && type !== 'multi_select') continue;
    const configured = definition[type].options || [];
    const current = existing[type]?.options || [];
    const names = new Set(current.map((option) => option.name));
    const additions = configured.filter((option) => !names.has(option.name));
    if (additions.length) patch[name] = { [type]: { options: [...current, ...additions] } };
  }
  return patch;
}
