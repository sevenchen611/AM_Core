// AM Platform core — 路由器 / 租戶解析
// 收到事件 → 取 groupId → 對「各租戶的群組綁定庫」逐一查(狀態=啟用),命中即該租戶。
// 快取 groupId → { tenant, binding }(TTL)。找不到 = 未綁定(照 BuildAM 行為,不落庫、不回話)。
//
// resolveGroupBinding 放在 core(路由器要用);模組從 ctx.binding 取,不必自己查。

const BINDING_CACHE_TTL_MS = 5 * 60 * 1000;
// 「影子記錄」已完成租戶歸屬，但只允許來源保存與候選抽取；
// 它必須能被路由，否則無法建立任何影子紀錄。
const ROUTABLE_BINDING_STATUSES = ['啟用', '影子記錄'];
const plain = (prop, kind = 'rich_text') => (prop?.[kind] || []).map((t) => t.plain_text || t.text?.content || '').join('');
const selected = (prop) => prop?.select?.name || '';
const selectedMany = (prop) => (prop?.multi_select || []).map((x) => x.name).filter(Boolean);

export function createRouter({ tenants, notionRequest, logger = console }) {
  // groupId → { tenant, binding, at }。binding 可為 null(已查過、確定未綁定)以避免重複打 Notion。
  const cache = new Map();

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

  // 供模組更新成員對照後即時失效快取(下次重查),或測試用。
  function invalidate(groupId) {
    if (groupId) cache.delete(groupId); else cache.clear();
  }

  return { resolveGroupBinding, invalidate };
}
