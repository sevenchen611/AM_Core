// Synthetic in-memory data only. Never load production records here.
export function fixture() {
  const dataSources = { projects: 'projects', spaces: 'spaces', workItems: 'works', budgets: 'budgets', contracts: 'contracts', attachments: 'attachments', constructionJournals: 'journals', constructionProgress: 'progress', constructionPhotos: 'photos' };
  const store = new Map(); let writes = 0, sequence = 0, clockTick = 0, failAfter = Infinity;
  const rich = s => ({ rich_text: [{ plain_text: s }] });
  function add(id, ds, properties) {
    for (const v of Object.values(properties)) v.type ||= Object.keys(v)[0];
    const p = { id, parent: { data_source_id: ds }, url: '', properties }; store.set(id, p); return p;
  }
  add('case-a', 'projects', { '專案名稱': { title: [{ plain_text: '合成測試案件' }] }, '館別代碼': rich('A') });
  add('case-b', 'projects', { '館別代碼': rich('B') });
  add('space-a', 'spaces', { '名稱': { title: [{ plain_text: '合成一樓現場' }] }, '專案': { relation: [{ id: 'case-a' }] } });
  add('space-other', 'spaces', { '名稱': { title: [{ plain_text: '合成其他空間' }] }, '專案': { relation: [{ id: 'case-a' }] } });
  add('space-b', 'spaces', { '專案': { relation: [{ id: 'case-b' }] } });
  for (const id of ['work-1', 'work-2']) add(id, 'works', { '工項': { title: [{ plain_text: id }] }, '空間': { relation: [{ id: 'space-a' }] }, '專案': { relation: [{ id: 'case-a' }] } });
  add('work-b', 'works', { '專案': { relation: [{ id: 'case-b' }] } });
  add('work-other-tenant', 'foreign', { '專案': { relation: [{ id: 'case-a' }] } });
  add('budget-1', 'budgets', { '專案': { relation: [{ id: 'case-a' }] }, '類別': { select: { name: '工程預算' } } });
  add('photo-1', 'photos', { '專案': { relation: [{ id: 'case-a' }] }, 'Drive 連結': { url: 'https://drive.google.com/file/d/synthetic/view' } });
  function matches(p, f) {
    if (!f) return true;
    if (f.and) return f.and.every(x => matches(p, x));
    const prop = p.properties[f.property];
    if (f.relation) return prop?.relation?.some(r => r.id === f.relation.contains);
    if (f.rich_text) return prop?.rich_text?.map(t => t.plain_text).join('') === f.rich_text.equals;
    throw new Error('Unexpected filter');
  }
  function normalize(props) {
    const p = structuredClone(props);
    for (const v of Object.values(p)) for (const t of v.rich_text || v.title || []) if (t.text) t.plain_text = t.text.content;
    return p;
  }
  const deps = { tenantKey: 'test', dataSources, actor: 'test-owner', access: { user: { role: 'owner' } },
    now: () => new Date(Date.UTC(2026, 9, 5, 0, 0, ++clockTick)).toISOString(),
    notionRequest: async (pathname, { method, body } = {}) => {
      if (pathname.startsWith('/v1/blocks/') && pathname.includes('/children')) return { results: [], has_more: false };
      if (pathname.startsWith('/v1/data_sources/') && !pathname.endsWith('/query')) return { properties: {} };
      if (pathname.endsWith('/query')) return { results: [...store.values()].filter(p => p.parent.data_source_id === pathname.split('/')[3] && matches(p, body.filter)), has_more: false };
      if (pathname === '/v1/pages' && method === 'POST') {
        if (++writes === failAfter) throw new Error('Injected transient write error');
        return add('new-' + (++sequence), body.parent.data_source_id, normalize(body.properties));
      }
      if (pathname.startsWith('/v1/pages/')) {
        const p = store.get(decodeURIComponent(pathname.split('/').at(-1)));
        if (!p) throw Error('Missing test page');
        if (method === 'PATCH') { writes++; Object.assign(p.properties, normalize(body.properties)); }
        return structuredClone(p);
      }
      throw Error('Unexpected path: ' + pathname);
    } };
  const input = { projectId: 'case-a', date: '2026-10-05', requestId: 'request-1', summary: '合成測試：兩工項共用工班', crews: [{ id: 'c1', name: '測試工班', trade: '泥作', count: 4 }], entries: ['work-1', 'work-2'].map((workItemId, i) => ({ workItemId, crewId: 'c1', content: '合成施工內容', quantity: 5, unit: '平方公尺', percent: (i + 1) * 20, photos: [{ id: 'photo-1', kind: 'photo', caption: '合成照片' }] })), source: { kind: 'web' } };
  return { deps, input, store, writes: () => writes, failAt: n => { failAfter = n; } };
}
