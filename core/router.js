// AM Platform core — 路由器 / 租戶解析
// 收到事件 → 取 groupId → 對「各租戶的群組綁定庫」逐一查(狀態=啟用),命中即該租戶。
// 快取 groupId → { tenant, binding }(TTL)。找不到 = 未綁定(照 BuildAM 行為,不落庫、不回話)。
//
// resolveGroupBinding 放在 core(路由器要用);模組從 ctx.binding 取,不必自己查。

const BINDING_CACHE_TTL_MS = 5 * 60 * 1000;
const plain = (prop, kind = 'rich_text') => (prop?.[kind] || []).map((t) => t.plain_text || t.text?.content || '').join('');
const selected = (prop) => prop?.select?.name || '';
const selectedMany = (prop) => (prop?.multi_select || []).map((x) => x.name).filter(Boolean);

export function createRouter({ tenants, notionRequest, logger = console }) {
  // groupId → { tenant, binding, at }。binding 可為 null(已查過、確定未綁定)以避免重複打 Notion。
  const cache = new Map();

  // 查單一租戶的群組綁定庫。命中回 binding 物件,否則 null。
  async function queryTenantBinding(tenant, groupId) {
    const groupBindings = tenant.dataSources.groupBindings;
    if (!groupBindings) return null;
    const result = await notionRequest(`/v1/data_sources/${encodeURIComponent(groupBindings)}/query`, {
      method: 'POST',
      tenantKey: tenant.key, // 嚴格綁定:此查詢只允許打這個租戶自己的庫
      body: {
        filter: {
          and: [
            { property: 'LINE 群組 ID', rich_text: { equals: groupId } },
            { property: '狀態', select: { equals: '啟用' } },
          ],
        },
        page_size: 1,
      },
    });
    const page = result.results?.[0];
    if (!page) return null;

    let members = {};
    try { members = JSON.parse((page.properties?.['成員對照']?.rich_text || []).map((t) => t.plain_text).join('')) || {}; } catch {}
    return {
      pageId: page.id,
      groupId: plain(page.properties?.['LINE 群組 ID']),
      groupName: plain(page.properties?.['群組名稱'], 'title'),
      projectPageId: page.properties?.['專案']?.relation?.[0]?.id || '',
      projectName: plain(page.properties?.['所屬目標']) || '',
      role: selected(page.properties?.['群組角色']),
      trade: selected(page.properties?.['工種']),
      // v2 群組治理欄位。欄位尚未升級的租戶會安全地取得空值；不影響既有路由。
      purpose: plain(page.properties?.['群組用途']),
      owner: plain(page.properties?.['主要負責人']) || plain(page.properties?.['我方主管']) || plain(page.properties?.['對方主管']),
      capabilities: selectedMany(page.properties?.['啟用功能']),
      statusUpdatePolicy: selected(page.properties?.['狀態更新權限']),
      defaultReminderTargets: plain(page.properties?.['預設提醒對象']),
      members,
    };
  }

  // 解析群組 → { tenant, binding }。未綁定回 { tenant: null, binding: null }。
  async function resolveGroupBinding(groupId) {
    if (!groupId) return { tenant: null, binding: null };
    const cached = cache.get(groupId);
    if (cached && Date.now() - cached.at < BINDING_CACHE_TTL_MS) {
      return { tenant: cached.tenant, binding: cached.binding };
    }

    let hit = { tenant: null, binding: null };
    // 依 tenants 載入順序決定優先權;命中即短路(一群只屬一個租戶)。
    for (const tenant of tenants) {
      try {
        const binding = await queryTenantBinding(tenant, groupId);
        if (binding) { hit = { tenant, binding }; break; }
      } catch (error) {
        logger.warn(`Group binding lookup failed (tenant=${tenant.key}, group=${groupId}): ${error.message}`);
      }
    }

    cache.set(groupId, { ...hit, at: Date.now() });
    return hit;
  }

  // 供模組更新成員對照後即時失效快取(下次重查),或測試用。
  function invalidate(groupId) {
    if (groupId) cache.delete(groupId); else cache.clear();
  }

  return { resolveGroupBinding, invalidate };
}
