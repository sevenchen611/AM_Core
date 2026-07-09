// 工種清單(單一來源):內建基本工種 ∪ 該租戶各資料庫「工種」select 已用過的選項。
// 下拉改用可輸入的 datalist,使用者直接打新工種即可(Notion select 寫入時自動建選項)。
// 抽自 BuildAM src/trades.js,改為多租戶:吃 deps(該租戶的 dataSources / notionRequest),
// 快取以租戶為鍵,避免跨租戶污染工種清單。

export const BASE_TRADES = [
  '拆除', '水電', '弱電', '防水', '泥作', '木作', '鐵工', '油漆', '設備', '收尾',
  '鋁窗', '窗簾', '玻璃', '消防',
];

const cacheByTenant = new Map(); // tenantKey → { at, list }

export async function listKnownTrades(deps) {
  const cached = cacheByTenant.get(deps.tenantKey);
  if (cached && Date.now() - cached.at < 60000) return cached.list;
  const found = new Set();
  const sources = [deps.dataSources.budgets, deps.dataSources.workItems, deps.dataSources.groupBindings];
  for (const ds of sources) {
    if (!ds) continue;
    try {
      const schema = await deps.notionRequest(`/v1/data_sources/${encodeURIComponent(ds)}`, { method: 'GET' });
      for (const o of schema.properties?.['工種']?.select?.options || []) found.add(o.name);
    } catch {}
  }
  const ordered = [...BASE_TRADES];
  for (const t of found) if (!ordered.includes(t) && t !== '其他') ordered.push(t);
  ordered.push('其他');
  const list = [...new Set(ordered)];
  cacheByTenant.set(deps.tenantKey, { at: Date.now(), list });
  return list;
}

export function clearTradeCache(tenantKey) {
  if (tenantKey) cacheByTenant.delete(tenantKey); else cacheByTenant.clear();
}
