// AM Platform core — 路由器 / 租戶解析
// 收到群組事件 → 取 groupId → 對「各租戶的群組綁定庫」逐一查,命中即該租戶。
// 收到一對一事件 → 用穩定 LINE userId 反查已啟用群組的「成員對照」；
// 只有唯一命中且租戶明確開啟 personal-assistant 時才建立私人路由。
// 快取 groupId → { tenant, binding }(TTL)。找不到 = 未綁定(照 BuildAM 行為,不落庫、不回話)。
//
// resolveGroupBinding 放在 core(路由器要用);模組從 ctx.binding 取,不必自己查。

const BINDING_CACHE_TTL_MS = 5 * 60 * 1000;
// 「影子記錄」已完成租戶歸屬，但只允許來源保存與候選抽取；
// 它必須能被路由，否則無法建立任何影子紀錄。
const ROUTABLE_BINDING_STATUSES = ['啟用', '影子記錄'];
// 影子群組只能保存來源，不足以授予私人助理存取；私人身分必須來自正式啟用群組。
const DIRECT_IDENTITY_STATUSES = ['啟用'];
const plain = (prop, kind = 'rich_text') => (prop?.[kind] || []).map((t) => t.plain_text || t.text?.content || '').join('');
const selected = (prop) => prop?.select?.name || '';
const selectedMany = (prop) => (prop?.multi_select || []).map((x) => x.name).filter(Boolean);

export function createRouter({ tenants, notionRequest, logger = console }) {
  // groupId → { tenant, binding, at }。binding 可為 null(已查過、確定未綁定)以避免重複打 Notion。
  const cache = new Map();
  // LINE userId → { tenant, binding, reason, at }。只存在執行期記憶體，不寫進 AMCore。
  const directCache = new Map();

  function directTenantEnabled(tenant) {
    return tenant?.runtimeEnabled !== false
      && tenant?.notionConfigured
      && tenant?.config?.personalAssistant?.enabled === true
      && Array.isArray(tenant?.modules)
      && tenant.modules.includes('personal-assistant');
  }

  function parseMembers(page) {
    try {
      const raw = (page.properties?.['成員對照']?.rich_text || [])
        .map((item) => item.plain_text || item.text?.content || '')
        .join('');
      const parsed = JSON.parse(raw || '{}');
      return parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  // 查單一租戶的群組綁定庫。命中回 binding 物件,否則 null。
  async function queryTenantBinding(tenant, groupId) {
    const groupBindings = tenant.dataSources.groupBindings;
    if (!groupBindings) return { found: false, binding: null };
    // 只用群組 ID 查詢，再在程式端判斷狀態。Notion 的 select filter 會先驗證
    // 選項是否存在；舊租戶若尚未建立「影子記錄」選項，將它放進 or filter
    // 會讓整筆查詢 400，連原本狀態為「啟用」的正式群組也會被誤判未綁定。
    const result = await notionRequest(`/v1/data_sources/${encodeURIComponent(groupBindings)}/query`, {
      method: 'POST',
      tenantKey: tenant.key, // 嚴格綁定:此查詢只允許打這個租戶自己的庫
      body: {
        filter: {
          and: [
            { property: 'LINE 群組 ID', rich_text: { equals: groupId } },
          ],
        },
        // 只需取兩筆即可判定是否重複；重複綁定一律 fail closed，不能任選一筆。
        page_size: 2,
      },
    });
    const pages = result.results || [];
    if (pages.length > 1) throw new Error('Ambiguous group binding: multiple rows have the same LINE group ID');
    const page = pages[0];
    if (!page) return { found: false, binding: null };

    const status = selected(page.properties?.['狀態']);
    // 即使是停用／未知狀態也回報 found=true，讓 resolveGroupBinding 能偵測
    // 「同一 groupId 同時存在於兩個租戶」的資料邊界衝突。
    if (!ROUTABLE_BINDING_STATUSES.includes(status)) return { found: true, binding: null };

    let members = {};
    try { members = JSON.parse((page.properties?.['成員對照']?.rich_text || []).map((t) => t.plain_text).join('')) || {}; } catch {}
    return { found: true, binding: {
      pageId: page.id,
      groupId: plain(page.properties?.['LINE 群組 ID']),
      groupName: plain(page.properties?.['群組名稱'], 'title'),
      status,
      projectPageId: page.properties?.['專案']?.relation?.[0]?.id || '',
      projectName: plain(page.properties?.['所屬目標']) || '',
      role: selected(page.properties?.['群組角色']),
      trade: selected(page.properties?.['工種']),
      // v2 群組治理欄位。欄位尚未升級的租戶會安全地取得空值；不影響既有路由。
      purpose: plain(page.properties?.['群組用途']),
      owner: plain(page.properties?.['主要負責人']) || plain(page.properties?.['我方主管']) || plain(page.properties?.['對方主管']),
      capabilities: selectedMany(page.properties?.['啟用功能']),
      // 會議功能管理台的群組級 rollout 模式。欄位尚未建立或未設定時留空，
      // 由 meetings/policy.js 採用舊租戶相容模式，避免部署後意外關閉既有會議流程。
      meetingMode: selected(page.properties?.['會議待辦模式']),
      meetingPolicyVersion: plain(page.properties?.['會議設定版本']),
      statusUpdatePolicy: selected(page.properties?.['狀態更新權限']),
      defaultReminderTargets: plain(page.properties?.['預設提醒對象']),
      members,
    } };
  }

  // 解析群組 → { tenant, binding }。未綁定回 { tenant: null, binding: null }。
  async function resolveGroupBinding(groupId) {
    if (!groupId) return { tenant: null, binding: null };
    const cached = cache.get(groupId);
    if (cached && Date.now() - cached.at < BINDING_CACHE_TTL_MS) {
      return { tenant: cached.tenant, binding: cached.binding };
    }

    let hit = { tenant: null, binding: null };
    const records = [];
    let lookupFailed = false;
    // 必須查完所有租戶才知道 groupId 是否跨租戶重複；不可命中第一筆就短路。
    for (const tenant of tenants) {
      if (tenant.runtimeEnabled === false || !tenant.notionConfigured) continue;
      try {
        const record = await queryTenantBinding(tenant, groupId);
        if (record.found) records.push({ tenant, binding: record.binding });
      } catch (error) {
        lookupFailed = true;
        logger.warn(`Group binding lookup failed (tenant=${tenant.key}, group=${groupId}): ${error.message}`);
      }
    }

    // 任一租戶查核失敗時，無法證明群組歸屬唯一；安全地拒絕，且不快取暫時性失敗。
    if (lookupFailed) return hit;
    if (records.length > 1) {
      logger.warn(`Ambiguous group binding across tenants (group=${groupId}, tenants=${records.map((r) => r.tenant.key).join(',')}) — ignored.`);
    } else if (records.length === 1 && records[0].binding) {
      hit = records[0];
    }

    cache.set(groupId, { ...hit, at: Date.now() });
    return hit;
  }

  // 查單一租戶中，哪些正式啟用群組曾以穩定 LINE userId 記錄這位成員。
  async function queryTenantDirectIdentity(tenant, userId) {
    const groupBindings = tenant.dataSources.groupBindings;
    if (!groupBindings) return [];
    const result = await notionRequest(`/v1/data_sources/${encodeURIComponent(groupBindings)}/query`, {
      method: 'POST',
      tenantKey: tenant.key,
      body: {
        filter: { property: '成員對照', rich_text: { contains: userId } },
        page_size: 100,
      },
    });

    const matches = [];
    for (const page of result.results || []) {
      const status = selected(page.properties?.['狀態']);
      if (!DIRECT_IDENTITY_STATUSES.includes(status)) continue;
      const memberNames = Object.entries(parseMembers(page))
        .filter(([, mappedUserId]) => String(mappedUserId || '').trim() === userId)
        .map(([name]) => String(name || '').trim())
        .filter(Boolean);
      if (!memberNames.length) continue; // Notion contains 是候選搜尋，仍須用完整 userId 精確比對。
      matches.push({
        pageId: page.id,
        groupId: plain(page.properties?.['LINE 群組 ID']),
        groupName: plain(page.properties?.['群組名稱'], 'title'),
        memberNames,
      });
    }
    return matches;
  }

  // 一對一 LINE 身分只在「唯一租戶」時成立。任一候選租戶查核失敗即 fail closed。
  async function resolveDirectBinding(rawUserId) {
    const userId = String(rawUserId || '').trim();
    if (!userId) return { tenant: null, binding: null, reason: 'not_found' };
    const cached = directCache.get(userId);
    if (cached && Date.now() - cached.at < BINDING_CACHE_TTL_MS) {
      return { tenant: cached.tenant, binding: cached.binding, reason: cached.reason };
    }

    const candidates = [];
    let lookupFailed = false;
    for (const tenant of tenants) {
      if (!directTenantEnabled(tenant)) continue;
      try {
        const groupMatches = await queryTenantDirectIdentity(tenant, userId);
        if (groupMatches.length) candidates.push({ tenant, groupMatches });
      } catch (error) {
        lookupFailed = true;
        logger.warn(`Direct LINE identity lookup failed (tenant=${tenant.key}): ${error.message}`);
      }
    }

    if (lookupFailed) return { tenant: null, binding: null, reason: 'lookup_failed' };
    let resolved = { tenant: null, binding: null, reason: 'not_found' };
    if (candidates.length > 1) {
      logger.warn(`Ambiguous direct LINE identity across tenants (count=${candidates.length}) — ignored.`);
      resolved = { tenant: null, binding: null, reason: 'ambiguous' };
    } else if (candidates.length === 1) {
      const { tenant, groupMatches } = candidates[0];
      const memberNames = [...new Set(groupMatches.flatMap((item) => item.memberNames))];
      resolved = {
        tenant,
        reason: 'bound',
        binding: {
          kind: 'direct',
          userId,
          displayName: memberNames[0] || '',
          memberNames,
          status: '啟用',
          source: 'active-group-member-map',
          groupBindingIds: [...new Set(groupMatches.map((item) => item.pageId).filter(Boolean))],
          groupIds: [...new Set(groupMatches.map((item) => item.groupId).filter(Boolean))],
          groupNames: [...new Set(groupMatches.map((item) => item.groupName).filter(Boolean))],
        },
      };
    }

    directCache.set(userId, { ...resolved, at: Date.now() });
    return resolved;
  }

  // 供模組更新成員對照後即時失效快取(下次重查),或測試用。
  function invalidate(groupId) {
    if (groupId) cache.delete(groupId); else cache.clear();
    // 群組成員或群組狀態可能已改變；私人身分候選也必須重新查核。
    directCache.clear();
  }

  function invalidateDirect(userId) {
    if (userId) directCache.delete(String(userId)); else directCache.clear();
  }

  return { resolveGroupBinding, resolveDirectBinding, invalidate, invalidateDirect };
}
