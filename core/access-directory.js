// Portal 專用 AM 租戶／群組目錄。
// 僅回傳授權所需的穩定群組綁定 Page ID 與非機密顯示欄位；不回 LINE ID、成員或秘密。

const propText = (prop, kind = 'rich_text') => (prop?.[kind] || [])
  .map((item) => item.plain_text || item.text?.content || '')
  .join('');
const propSelect = (prop) => prop?.select?.name || '';

function portalIdentity(tenant) {
  const config = tenant.config?.portal || {};
  const aliases = Array.isArray(config.featureAliases) ? config.featureAliases : [];
  const featureKey = aliases.find((key) => /^am-[a-z0-9_-]+$/i.test(key)) || `am-${tenant.key}`;
  return {
    featureKey,
    label: String(config.label || `${tenant.displayName || tenant.key} AM`).slice(0, 120),
  };
}

function pendingNote(tenant) {
  return String(tenant.config?.portal?.authorizationNote
    || '尚未完成群組綁定與資料隔離設定；完成遷移前不可分派新權限。').slice(0, 240);
}

export function createAccessDirectory({ tenants, notionRequest, logger = console }) {
  return async function accessDirectory() {
    const directory = [];
    for (const tenant of tenants) {
      const identity = portalIdentity(tenant);
      const sourceId = tenant.dataSources?.groupBindings;
      let assignable = tenant.runtimeEnabled !== false
        && tenant.authorizationReady !== false
        && Boolean(tenant.notionConfigured && sourceId);
      let status = assignable ? 'ready' : 'migration-pending';
      let note = assignable ? '' : pendingNote(tenant);
      const groups = [];

      if (assignable) {
        try {
          let cursor;
          do {
            const body = { page_size: 100, sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }] };
            if (cursor) body.start_cursor = cursor;
            const result = await notionRequest(`/v1/data_sources/${encodeURIComponent(sourceId)}/query`, {
              method: 'POST', tenantKey: tenant.key, body,
            });
            for (const page of result.results || []) {
              const props = page.properties || {};
              groups.push({
                id: page.id,
                name: propText(props['群組名稱'], 'title') || '未命名群組',
                status: propSelect(props['狀態']) || '停用',
                role: propSelect(props['群組角色']),
                owner: propText(props['主要負責人']) || propText(props['我方主管']) || propText(props['對方主管']),
              });
            }
            cursor = result.has_more ? result.next_cursor : null;
          } while (cursor);
        } catch (error) {
          // 單一租戶目錄暫時失敗時，其他租戶仍可顯示；故障租戶 fail closed，不可新增授權。
          assignable = false;
          status = 'temporarily-unavailable';
          note = '群組目錄目前無法驗證；恢復前不可分派或變更此租戶權限。';
          groups.length = 0;
          logger.warn(`Portal access directory unavailable (tenant=${tenant.key}): ${error.message}`);
        }
      }

      directory.push({
        key: tenant.key,
        ...identity,
        assignable,
        status,
        note,
        groups,
      });
    }
    return { tenants: directory };
  };
}

