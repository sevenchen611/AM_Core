// modules/construction — 共用小工具(無外部相依,由各子檔共用)
// 全部改為「吃 deps」的多租戶形狀:deps 由 index.js 依 ctx.tenant + platform 每次組出,
// deps.notionRequest 已鎖定該租戶 tenantKey,deps.dataSources 為該租戶自己的庫。
// ⚠️ 絕不使用模組級全域 deps(多租戶並發會互相污染);deps 一律逐呼叫傳入。

export const plain = (items) => (items || []).map((x) => x.plain_text || '').join('');
export const sameId = (a, b) => a && b && String(a).replace(/-/g, '').toLowerCase() === String(b).replace(/-/g, '').toLowerCase();

// rich_text / title 片段(空值 → 空陣列,方便清空欄位)
export const textFrag = (v) => (v ? [{ type: 'text', text: { content: String(v).slice(0, 1900) } }] : []);
export const normalText = (content) => ({ type: 'text', text: { content: String(content) } });
export const blueText = (content) => ({ type: 'text', text: { content: String(content) }, annotations: { color: 'blue' } });

// 台北時間好讀格式(單據內文顯示用;Notion 日期欄位仍存 ISO)
export function taipeiStamp(iso) {
  const t = iso ? Date.parse(iso) : Date.now();
  return new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

// 分頁取回整個資料源查詢結果(deps 已鎖定租戶)
export async function queryAll(deps, dataSourceId, filter) {
  const results = [];
  let cursor;
  do {
    const body = { page_size: 100 };
    if (filter) body.filter = filter;
    if (cursor) body.start_cursor = cursor;
    const r = await deps.notionRequest(`/v1/data_sources/${encodeURIComponent(dataSourceId)}/query`, { method: 'POST', body });
    results.push(...(r.results || []));
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return results;
}

export async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

// 頁面標題快取:Notion 頁 id 全域唯一,跨租戶不會撞,故可用模組級快取。
const nameCache = new Map();
export async function pageName(deps, pageId) {
  if (!pageId) return '';
  if (nameCache.has(pageId)) return nameCache.get(pageId);
  try {
    const page = await deps.notionRequest(`/v1/pages/${encodeURIComponent(pageId)}`, { method: 'GET' });
    let name = '';
    for (const value of Object.values(page.properties || {})) {
      if (value.type === 'title') { name = plain(value.title); break; }
    }
    nameCache.set(pageId, name);
    return name;
  } catch {
    return '';
  }
}

// 專案 id → 館別代碼(每租戶各一份快取,10 分鐘)
const projectCodeCache = new Map(); // tenantKey → { at, map }
export async function projectCodeMap(deps) {
  const cached = projectCodeCache.get(deps.tenantKey);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.map;
  const result = await deps.notionRequest(`/v1/data_sources/${encodeURIComponent(deps.dataSources.projects)}/query`, {
    method: 'POST', body: { page_size: 100 },
  });
  const map = {};
  for (const page of result.results || []) {
    map[page.id] = plain(page.properties['館別代碼']?.rich_text);
  }
  projectCodeCache.set(deps.tenantKey, { at: Date.now(), map });
  return map;
}

// 由 URL 取子專案可視範圍:無/all → null(全部);none → 空集合;否則逗號分隔的館別代碼集合。
// (scope 由 index.js 的 webRoute 依 Portal 授權注入 URL,不信任前端原始參數。)
export function parseScope(url) {
  const raw = url.searchParams.get('scope');
  if (!raw || raw === 'all') return null;
  if (raw === 'none') return new Set();
  return new Set(raw.split(',').filter(Boolean));
}

// 可視範圍過濾:scope=null → 全部;Set(館別代碼) → 只放行勾選的專案
export async function inScope(deps, scope, projectId) {
  if (!scope) return true;
  if (!projectId) return false;
  const map = await projectCodeMap(deps);
  return scope.has(map[projectId] || '');
}

// 確認某專案在可視範圍內(否則拋錯);寫入前的權限守衛
export async function assertProjectInScope(deps, scope, projectId) {
  if (!scope) return;
  const page = await deps.notionRequest(`/v1/pages/${encodeURIComponent(projectId)}`, { method: 'GET' });
  const code = plain(page.properties['館別代碼']?.rich_text);
  if (!scope.has(code)) throw new Error('無此專案的檢視權限');
}

export async function appendHistory(deps, pageId, content) {
  const richText = Array.isArray(content) ? content : [normalText(content)];
  await deps.notionRequest(`/v1/blocks/${encodeURIComponent(pageId)}/children`, {
    method: 'PATCH',
    body: { children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: richText } }] },
  });
}

// 訊息頁的附件照片(Drive 連結 → fileId),供開回饋單/掛回饋單取照片
export async function attachmentPhotos(deps, messagePageId) {
  if (!deps.dataSources.attachments) return [];
  try {
    const result = await deps.notionRequest(`/v1/data_sources/${encodeURIComponent(deps.dataSources.attachments)}/query`, {
      method: 'POST',
      body: { filter: { property: '訊息', relation: { contains: messagePageId } }, page_size: 10 },
    });
    return (result.results || [])
      .map((page) => {
        const url = page.properties['Drive 連結']?.url || '';
        const fileId = (url.match(/\/file\/d\/([^/]+)/) || [])[1] || '';
        return fileId ? { url, fileId } : null;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Drive 檔案搬移(歸檔;背景執行,失敗記 log)
export async function moveDriveFile(deps, fileId, newParentId) {
  const token = await deps.getDriveAccessToken();
  const meta = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=parents`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const metaJson = await meta.json();
  if (!meta.ok) throw new Error(`Drive file lookup failed: ${JSON.stringify(metaJson).slice(0, 200)}`);
  const oldParents = (metaJson.parents || []).join(',');
  if (metaJson.parents?.includes(newParentId)) return;
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?addParents=${encodeURIComponent(newParentId)}&removeParents=${encodeURIComponent(oldParents)}`,
    { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' },
  );
  if (!response.ok) throw new Error(`Drive move failed: ${response.status} ${await response.text()}`);
}

// 附件同步掛載(空間/工項)+ Drive 歸檔搬移(背景);回傳附件數
export async function archiveAttachments(deps, messagePageId, messagePage, spaceId, workItemId) {
  if (!deps.dataSources.attachments) return 0;
  const result = await deps.notionRequest(`/v1/data_sources/${encodeURIComponent(deps.dataSources.attachments)}/query`, {
    method: 'POST',
    body: { filter: { property: '訊息', relation: { contains: messagePageId } }, page_size: 20 },
  });
  const attachments = result.results || [];
  if (!attachments.length) return 0;

  const projectId = messagePage.properties['專案']?.relation?.[0]?.id || null;
  const [projectName, spaceName, workItemName] = await Promise.all([
    projectId ? pageName(deps, projectId) : '未分專案',
    spaceId ? pageName(deps, spaceId) : '未分空間',
    workItemId ? pageName(deps, workItemId) : '未分工項',
  ]);

  await Promise.all(attachments.map((attachment) =>
    deps.notionRequest(`/v1/pages/${encodeURIComponent(attachment.id)}`, {
      method: 'PATCH',
      body: { properties: {
        '空間': { relation: spaceId ? [{ id: spaceId }] : [] },
        '工項': { relation: workItemId ? [{ id: workItemId }] : [] },
      } },
    })
  ));

  const moves = attachments.map((attachment) => ({
    fileId: ((attachment.properties['Drive 連結']?.url || '').match(/\/file\/d\/([^/]+)/) || [])[1],
    dateStr: (attachment.properties['日期']?.date?.start || new Date().toISOString()).slice(0, 10),
  })).filter((m) => m.fileId);

  if (moves.length && deps.driveConfigured) {
    (async () => {
      for (const move of moves) {
        try {
          const projectFolder = await deps.ensureDriveFolder(projectName, deps.driveRootFolderId);
          const spaceFolder = await deps.ensureDriveFolder(spaceName, projectFolder);
          const workItemFolder = await deps.ensureDriveFolder(workItemName, spaceFolder);
          const dateFolder = await deps.ensureDriveFolder(move.dateStr, workItemFolder);
          await moveDriveFile(deps, move.fileId, dateFolder);
        } catch (error) {
          console.warn(`Drive archive failed for ${move.fileId}: ${error.message}`);
        }
      }
    })();
  }
  return attachments.length;
}
