// 工程日誌：原始回報一次保存，施工索引完成後即更新進度，並掛回原工項與現場。
import { createHash } from 'node:crypto';
import { queryAll, plain, sameId, textFrag, parseScope, sendJson } from './common.js';
import { assertManagedProject } from './master-data.js';
import { renderJournalPage } from './journal-page.js';

const locks = new Map();
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const rel = (ids) => ({ relation: ids.map(id => ({ id })) });
const text = value => String(value ?? '').trim();
const rt = value => ({ rich_text: textFrag(value) });
const field = (p, key) => plain(p.properties?.[key]?.rich_text || p.properties?.[key]?.title);
const pid = p => p.parent?.data_source_id || '';
const projectOf = p => p.properties?.['專案']?.relation?.[0]?.id;
const digest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const stamp = deps => deps.now ? deps.now() : new Date().toISOString();
function required(value, label, max = 1900) {
  const v = text(value);
  if (!v || v.length > max) throw fail(`請填寫${label}，上限 ${max} 字`);
  return v;
}
function optional(value, label, max = 1900) {
  const v = text(value);
  if (v.length > max) throw fail(`${label}上限 ${max} 字，請分段補登或附原始檔案參照`);
  return v;
}
function dateOnly(value) {
  const s = text(value);
  const d = new Date(`${s}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw fail('施工日期不正確');
  return s;
}
function numeric(value, label, max = Infinity, integer = false) {
  if (value === '' || value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isInteger(value))) throw fail(`${label}不正確`);
  return value;
}
function configured(deps) {
  if (!deps.dataSources.constructionJournals || !deps.dataSources.constructionProgress || !deps.dataSources.constructionPhotos) throw fail('工程日誌資料庫尚未建置，請先執行升級套件', 503);
}
function actor(deps) { return required(deps.actor, '登入身分', 200); }
async function owned(deps, id, key, projectId) {
  const ds = deps.dataSources[key];
  if (!ds) throw fail(`尚未設定 ${key} 資料庫`, 503);
  const p = await deps.notionRequest(`/v1/pages/${encodeURIComponent(required(id, '資料參照', 100))}`, { method: 'GET' });
  if (!sameId(pid(p), ds) || p.archived || p.in_trash) throw fail('資料不屬於目前租戶或已封存');
  if (projectId && !sameId(projectOf(p), projectId)) throw fail('資料不屬於目前案件');
  return p;
}
async function projectRows(deps, key, projectId) {
  return deps.dataSources[key] ? queryAll(deps, deps.dataSources[key], { property: '專案', relation: { contains: projectId } }) : [];
}
function chunks(value) {
  const s = JSON.stringify(value);
  if (s.length > 40000) throw fail('單份日誌內容過長，請拆成多份回報');
  // Avoid splitting UTF-16 surrogate pairs at Notion's rich-text boundary.
  const parts = [];
  let part = '';
  for (const char of s) {
    if (part.length + char.length > 1800) { parts.push(part); part = ''; }
    part += char;
  }
  if (part) parts.push(part);
  return parts.map(content => ({ type: 'text', text: { content } }));
}
async function exclusive(key, fn) {
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const turn = new Promise(resolve => { release = resolve; });
  const pending = previous.then(() => turn);
  locks.set(key, pending);
  await previous;
  try { return await fn(); } finally { release(); if (locks.get(key) === pending) locks.delete(key); }
}

export async function journalOptions(deps, scope, projectId, permissions = {}) {
  configured(deps);
  await assertManagedProject(deps, scope, projectId);
  const [works, spaces, budgets, contracts, photos, attachments] = await Promise.all([
    projectRows(deps, 'workItems', projectId),
    projectRows(deps, 'spaces', projectId),
    permissions.canBudget ? projectRows(deps, 'budgets', projectId) : [],
    permissions.canContract ? projectRows(deps, 'contracts', projectId) : [],
    projectRows(deps, 'constructionPhotos', projectId),
    projectRows(deps, 'attachments', projectId),
  ]);
  const choice = p => ({ id: p.id, name: plain(Object.values(p.properties || {}).find(v => v.type === 'title')?.title) || p.id });
  return { works: works.map(p => ({ ...choice(p), spaceIds: (p.properties['空間']?.relation || []).map(r => r.id) })), spaces: spaces.map(choice), budgets: budgets.filter(p => p.properties['類別']?.select?.name !== '總預算').map(choice), contracts: contracts.map(choice),
    photos: [...photos.map(p => ({ ...choice(p), kind: 'photo', url: p.properties['Drive 連結']?.url || '' })),
      ...attachments.filter(p => /image|照片/i.test(field(p, '檔案類型')) || /\.(png|jpe?g|webp|heic)$/i.test(choice(p).name)).map(p => ({ ...choice(p), kind: 'attachment', url: p.properties['Drive 連結']?.url || '' }))],
    canVoid: Boolean(deps.access?.isPlatformOwner || deps.access?.user?.role === 'owner') };
}

export async function validateJournal(deps, scope, input, permissions = {}) {
  configured(deps);
  if (!input || typeof input !== 'object') throw fail('日誌格式不正確');
  const projectId = required(input.projectId, '案件', 100);
  await assertManagedProject(deps, scope, projectId);
  const date = dateOnly(input.date);
  const requestId = required(input.requestId, '提交識別碼', 100);
  if (!Array.isArray(input.crews) || input.crews.length > 40) throw fail('工班清單格式不正確');
  const crews = input.crews.map(c => ({ id: required(c.id, '工班列識別碼', 100), name: required(c.name, '工班名稱', 200), trade: required(c.trade, '工種', 100), count: numeric(c.count, '人數', 10000, true) }));
  if (new Set(crews.map(c => c.id)).size !== crews.length) throw fail('工班列不可重複');
  const crewIdentity = c => `${c.name.normalize('NFKC').replace(/\s+/g, ' ').toLowerCase()}\u0000${c.trade.normalize('NFKC').replace(/\s+/g, ' ').toLowerCase()}`;
  if (new Set(crews.map(crewIdentity)).size !== crews.length) throw fail('同一工班與工種請合併人數後填一列，避免重複計算');
  const noWork = input.noWork === true;
  if (!Array.isArray(input.entries) || input.entries.length > 40 || (!noWork && !input.entries.length)) throw fail('請至少填一筆施工紀錄，或勾選今日無施工');
  if (noWork && (input.entries.length || crews.some(c => c.count !== 0))) throw fail('無施工日誌不可含施工紀錄或未確定／非零人數');
  const summary = required(input.summary, '今日總結／停工原因');
  const entries = [];
  for (const e of input.entries) {
    const workItemId = required(e.workItemId, '原有工項', 100);
    const work = await owned(deps, workItemId, 'workItems', projectId);
    const assignedSpaces = (work.properties['空間']?.relation || []).map(r => r.id);
    const requestedSpace = optional(e.spaceId, '現場空間', 100);
    if (requestedSpace && assignedSpaces.length && !assignedSpaces.some(id => sameId(id, requestedSpace))) throw fail('現場空間不在此工項的施工範圍');
    const spaceIds = requestedSpace ? [requestedSpace] : assignedSpaces;
    for (const id of spaceIds) await owned(deps, id, 'spaces', projectId);
    const crewId = required(e.crewId, '施工工班', 100);
    if (!crews.some(c => c.id === crewId)) throw fail('施工紀錄未連到日誌工班');
    const budgetId = text(e.budgetId), contractId = text(e.contractId);
    if (budgetId) {
      if (!permissions.canBudget) throw fail('無預算關聯權限', 403);
      const b = await owned(deps, budgetId, 'budgets', projectId);
      if (b.properties['類別']?.select?.name === '總預算') throw fail('請選工程預算或小項，不能連總預算');
    }
    if (contractId) {
      if (!permissions.canContract) throw fail('無合約關聯權限', 403);
      await owned(deps, contractId, 'contracts', projectId);
    }
    if (!Array.isArray(e.photos || []) || (e.photos || []).length > 20) throw fail('每筆施工紀錄照片上限 20 張');
    const photos = [];
    for (const f of e.photos || []) {
      if (!['photo', 'attachment'].includes(f.kind)) throw fail('照片來源不正確');
      const page = await owned(deps, f.id, f.kind === 'photo' ? 'constructionPhotos' : 'attachments', projectId);
      const url = page.properties['Drive 連結']?.url || '';
      if (!/^https:\/\/drive\.google\.com\//.test(url)) throw fail('照片尚無可保存的 Drive 原檔');
      photos.push({ id: page.id, kind: f.kind, url, caption: optional(f.caption, '照片說明', 500) });
    }
    const quantity = numeric(e.quantity, '今日施作量');
    const unit = optional(e.unit, '施作量單位', 50);
    if (quantity != null && !unit) throw fail('填施作量時請填單位');
    entries.push({ workItemId, spaceIds, crewId, budgetId, contractId, content: required(e.content, '施工內容'),
      location: optional(e.location, '施工位置', 200), quantity, unit, percent: numeric(e.percent, '累計完成百分比', 100),
      blocker: optional(e.blocker, '現場障礙'), nextStep: optional(e.nextStep, '下一步'), photos });
  }
  if (new Set(entries.map(e => e.workItemId)).size !== entries.length) throw fail('同一份日誌同一工項請合併為一筆，避免施作量重複');
  const source = { kind: input.source?.kind || 'web', reference: optional(input.source?.reference, '原始來源參照', 1000), original: optional(input.source?.original, '原始回報內容', 8000) };
  if (!['web', 'line', 'report'].includes(source.kind)) throw fail('回報來源不正確');
  if (source.kind !== 'web' && (!source.reference || !source.original)) throw fail('補登需保留原始 LINE 群組／時間／發話者或報表連結與原文');
  return { projectId, date, requestId, summary, noWork, crews, entries, source };
}

function journalView(p) {
  return { id: p.id, date: p.properties['施工日期']?.date?.start, status: p.properties['狀態']?.select?.name,
    headcount: p.properties['進場人數']?.number ?? null, summary: field(p, '今日總結'), reporter: field(p, '填報者'),
    reviewer: field(p, '確認者'), reviewedAt: p.properties['確認時間']?.date?.start || '', reviewNote: field(p, '確認說明'),
    updatedAt: p.properties['更新時間']?.date?.start || '' };
}
export async function submitJournal(deps, scope, input, permissions = {}) {
  const normalized = await validateJournal(deps, scope, input, permissions);
  const who = actor(deps);
  return exclusive(`${deps.tenantKey}:${normalized.projectId}`, async () => {
    const hash = digest(normalized);
    const existing = await queryAll(deps, deps.dataSources.constructionJournals, { and: [
      { property: '專案', relation: { contains: normalized.projectId } },
      { property: '提交識別碼', rich_text: { equals: normalized.requestId } },
    ] });
    if (existing.length > 1) throw fail('提交識別碼重複，請管理人員檢查', 409);
    let journal = existing[0];
    if (journal && field(journal, '內容雜湊') !== hash) throw fail('這個提交識別碼已保存不同內容，請重新開一份日誌', 409);
    if (journal && field(journal, '填報者') !== who) throw fail('不可接續其他人的提交', 403);
    if (journal && journalView(journal).status !== '整理中') return { ok: true, replay: true, journal: journalView(journal) };
    if (!journal) {
      const count = normalized.crews.some(c => c.count == null) ? null : normalized.crews.reduce((s, c) => s + c.count, 0);
      journal = await deps.notionRequest('/v1/pages', { method: 'POST', body: {
        parent: { type: 'data_source_id', data_source_id: deps.dataSources.constructionJournals },
        properties: { '日誌': { title: textFrag(`${normalized.date} 工程日誌`) }, '專案': rel([normalized.projectId]),
          '施工日期': { date: { start: normalized.date } }, '狀態': { select: { name: '整理中' } },
          '進場人數': { number: count }, '今日總結': rt(normalized.summary), '填報者': rt(who),
          '提交識別碼': rt(normalized.requestId), '內容雜湊': rt(hash), '原始回報': { rich_text: chunks(normalized) } },
        children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: textFrag(`填報者：${who}；保存時間：${new Date().toISOString()}；来源：${normalized.source.kind} ${normalized.source.reference}\n${normalized.summary}`) } }],
      } });
    }
    const rows = await queryAll(deps, deps.dataSources.constructionProgress, { property: '日誌', relation: { contains: journal.id } });
    for (let i = 0; i < normalized.entries.length; i++) {
      const e = normalized.entries[i], key = `${normalized.requestId}:${i}`;
      if (rows.some(p => field(p, '紀錄識別碼') === key)) continue;
      const crew = normalized.crews.find(c => c.id === e.crewId);
      await deps.notionRequest('/v1/pages', { method: 'POST', body: {
        parent: { type: 'data_source_id', data_source_id: deps.dataSources.constructionProgress },
        properties: { '施工紀錄': { title: textFrag(`${normalized.date} ${e.content.slice(0, 70)}`) },
          '專案': rel([normalized.projectId]), '日誌': rel([journal.id]), '工項': rel([e.workItemId]),
          '空間': rel(e.spaceIds),
          '預算項目': rel(e.budgetId ? [e.budgetId] : []), '合約': rel(e.contractId ? [e.contractId] : []),
          '施工日期': { date: { start: normalized.date } }, '紀錄識別碼': rt(key), '工班': rt(crew.name), '工種': rt(crew.trade),
          '施工位置': rt(e.location), '施工內容': rt(e.content), '今日施作量': { number: e.quantity }, '單位': rt(e.unit),
          '累計完成率': { number: e.percent }, '障礙': rt(e.blocker), '下一步': rt(e.nextStep),
          '現場照片': rel(e.photos.filter(f => f.kind === 'photo').map(f => f.id)),
          '來源附件': rel(e.photos.filter(f => f.kind === 'attachment').map(f => f.id)) },
        children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: textFrag(`來源：工程日誌 ${journal.id}；施工日期 ${normalized.date}；填報 ${who}\n${e.content}\n${e.photos.map(f => `${f.caption} ${f.url}`).join('\n')}`) } }],
      } });
    }
    journal = await deps.notionRequest(`/v1/pages/${encodeURIComponent(journal.id)}`, { method: 'PATCH', body: { properties: { '狀態': { select: { name: '已更新' } }, '更新時間': { date: { start: stamp(deps) } } } } });
    return { ok: true, journal: journalView(journal) };
  });
}

export async function confirmJournal(deps, scope, input) {
  configured(deps);
  if (!(deps.access?.isPlatformOwner || deps.access?.user?.role === 'owner')) throw fail('僅工程管理者可確認日誌', 403);
  const p = await owned(deps, input.journalId, 'constructionJournals');
  await assertManagedProject(deps, scope, projectOf(p));
  return exclusive(`${deps.tenantKey}:${projectOf(p)}`, async () => {
    const current = await owned(deps, p.id, 'constructionJournals', projectOf(p));
    if (['已更新', '已確認'].includes(journalView(current).status)) return { ok: true, replay: true };
    if (journalView(current).status !== '待確認') throw fail('日誌尚未整理完成，請原填報者重送完成索引', 409);
    const note = required(input.note, '確認說明');
    await deps.notionRequest(`/v1/pages/${encodeURIComponent(p.id)}`, { method: 'PATCH', body: { properties: {
      '狀態': { select: { name: '已確認' } }, '確認者': rt(actor(deps)), '確認時間': { date: { start: new Date().toISOString() } }, '確認說明': rt(note),
    } } });
    return { ok: true };
  });
}

export async function voidJournal(deps, scope, input) {
  configured(deps);
  if (!(deps.access?.isPlatformOwner || deps.access?.user?.role === 'owner')) throw fail('僅工程管理者可作廢日誌', 403);
  const p = await owned(deps, input.journalId, 'constructionJournals');
  await assertManagedProject(deps, scope, projectOf(p));
  const note = required(input.note, '作廢原因');
  return exclusive(`${deps.tenantKey}:${projectOf(p)}`, async () => {
    const current = await owned(deps, p.id, 'constructionJournals', projectOf(p));
    if (journalView(current).status === '作廢') return { ok: true, replay: true };
    await deps.notionRequest(`/v1/pages/${encodeURIComponent(p.id)}`, { method: 'PATCH', body: { properties: {
      '狀態': { select: { name: '作廢' } }, '作廢者': rt(actor(deps)), '作廢時間': { date: { start: new Date().toISOString() } }, '作廢原因': rt(note),
    } } });
    return { ok: true };
  });
}

export async function projectJournalReport(deps, scope, projectId) {
  configured(deps);
  await assertManagedProject(deps, scope, projectId);
  const [journals, rows, works] = await Promise.all([projectRows(deps, 'constructionJournals', projectId), projectRows(deps, 'constructionProgress', projectId), projectRows(deps, 'workItems', projectId)]);
  const byId = new Map(journals.map(p => [p.id.replace(/-/g, '').toLowerCase(), p]));
  const view = journals.map(p => ({ ...journalView(p),
    voidReason: field(p, '作廢原因'), voidedBy: field(p, '作廢者'), voidedAt: p.properties['作廢時間']?.date?.start || '',
    original: JSON.parse(field(p, '原始回報')) })).sort((a, b) => b.date.localeCompare(a.date));
  const items = works.map(w => {
    const records = rows.filter(p => p.properties['工項']?.relation?.some(r => sameId(r.id, w.id))).map(p => {
      const j = byId.get((p.properties['日誌']?.relation?.[0]?.id || '').replace(/-/g, '').toLowerCase());
      if (!j || ['整理中', '作廢'].includes(journalView(j).status)) return null;
      const raw = JSON.parse(field(j, '原始回報'));
      const entry = raw.entries.find(e => sameId(e.workItemId, w.id));
      const jv = journalView(j), effective = ['已更新', '已確認'].includes(jv.status);
      return { id: p.id, journalId: j.id, date: raw.date, status: jv.status, confirmed: effective, effective,
        reviewedAt: jv.updatedAt || jv.reviewedAt, spaceIds: entry?.spaceIds || [],
        crewCount: raw.crews.find(c => c.id === entry?.crewId)?.count ?? null,
        budgetId: entry?.budgetId || '', contractId: entry?.contractId || '', source: raw.source,
        content: field(p, '施工內容'), crew: field(p, '工班'), location: field(p, '施工位置'),
        quantity: p.properties['今日施作量']?.number ?? null, unit: field(p, '單位'), percent: p.properties['累計完成率']?.number ?? null,
        blocker: field(p, '障礙'), nextStep: field(p, '下一步'), photos: entry?.photos || [] };
    }).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date) || b.reviewedAt.localeCompare(a.reviewedAt));
    const confirmed = records.filter(r => r.confirmed && r.percent != null);
    const latestDate = confirmed[0]?.date;
    const latestTime = confirmed[0]?.reviewedAt;
    const latest = confirmed.filter(r => r.date === latestDate && r.reviewedAt === latestTime);
    const conflict = new Set(latest.map(r => r.percent)).size > 1;
    return { id: w.id, name: field(w, '工項'), percent: conflict ? null : (latest[0]?.percent ?? null), conflict, records };
  });
  return { journals: view, items };
}

// Original engineering/site pages display these records beneath their existing content.
export async function constructionHistoryForPage(deps, scope, page, permissions = {}) {
  if (!deps.dataSources.constructionJournals || !deps.dataSources.constructionProgress || !deps.dataSources.constructionPhotos) return null;
  const type = ['workItems', 'spaces', 'budgets', 'contracts'].find(key => sameId(pid(page), deps.dataSources[key]));
  if (!type) return null;
  if (type === 'budgets' && !permissions.canBudget) throw fail('無預算檢視權限', 403);
  if (type === 'contracts' && !permissions.canContract) throw fail('無合約檢視權限', 403);
  const projectId = projectOf(page);
  await owned(deps, page.id, type, projectId);
  await assertManagedProject(deps, scope, projectId);
  const report = await projectJournalReport(deps, scope, projectId);
  const items = report.items.map(item => ({ ...item, records: item.records.filter(r =>
    type === 'workItems' ? sameId(item.id, page.id) : type === 'spaces' ? r.spaceIds.some(id => sameId(id, page.id)) :
      sameId(type === 'budgets' ? r.budgetId : r.contractId, page.id)) })).filter(item => item.records.length || (type === 'workItems' && sameId(item.id, page.id)));
  const url = `/journal?tenant=${encodeURIComponent(deps.tenantKey)}&project=${encodeURIComponent(projectId)}${type === 'workItems' ? '&work=' + encodeURIComponent(page.id) : ''}`;
  return { projectId, type, items, journalUrl: url };
}

async function jsonBody(req) {
  const parts = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 160000) throw fail('日誌內容過長', 413); parts.push(c); }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw fail('回報 JSON 格式不正確'); }
}
export async function handleJournalRequest(req, res, pathname, url, deps) {
  const scope = parseScope(url), projectId = url.searchParams.get('project');
  const permissions = { canBudget: url.searchParams.get('budget') === '1', canContract: url.searchParams.get('contract') === '1' };
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET' && pathname === '/journal') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderJournalPage(deps.tenantKey, projectId, url.searchParams.get('work')));
    }
    if (req.method === 'GET' && pathname === '/journal/api/projects') {
      const pages = await queryAll(deps, deps.dataSources.projects);
      return sendJson(res, 200, { projects: pages.filter(p => !scope || scope.has(field(p, '館別代碼'))).map(p => ({ id: p.id, name: field(p, '專案名稱') })) });
    }
    if (req.method === 'GET' && pathname === '/journal/api/options') return sendJson(res, 200, await journalOptions(deps, scope, projectId, permissions));
    if (req.method === 'GET' && pathname === '/journal/api/report') return sendJson(res, 200, await projectJournalReport(deps, scope, projectId));
    if (req.method === 'POST' && pathname === '/journal/api/submit') return sendJson(res, 201, await submitJournal(deps, scope, await jsonBody(req), permissions));
    if (req.method === 'POST' && pathname === '/journal/api/confirm') return sendJson(res, 200, await confirmJournal(deps, scope, await jsonBody(req)));
    if (req.method === 'POST' && pathname === '/journal/api/void') return sendJson(res, 200, await voidJournal(deps, scope, await jsonBody(req)));
    if (req.method === 'POST' && pathname === '/journal/api/photos/upload') {
      const { uploadJournalPhoto } = await import('./journal-photos.js');
      return sendJson(res, 201, await uploadJournalPhoto(deps, scope, { projectId, date: url.searchParams.get('date'), filename: url.searchParams.get('filename'), caption: url.searchParams.get('caption'), contentType: req.headers['content-type'], stream: req }));
    }
    return sendJson(res, 404, { error: 'Not found' });
  } catch (e) { return sendJson(res, e.statusCode || 500, { error: e.statusCode ? e.message : '保存失敗，請保留表單後重試；管理者可查伺服器紀錄' }); }
}

export const __test = { dateOnly, numeric, chunks };
