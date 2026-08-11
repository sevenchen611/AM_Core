// 工程儀表板主檔維護：讓有工程儀表板權限的人直接建立空間、工種與工項。
// 所有寫入都使用 deps.notionRequest（已綁定 tenantKey），且在建立 relation 前
// 重新確認專案／空間確實屬於目前租戶與目前案件，避免跨租戶或跨案件混掛。

import { plain, queryAll, sameId, textFrag } from './common.js';
import { clearTradeCache, listKnownTrades } from './trades.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WORK_ITEM_STATUSES = new Set(['未開始', '進行中', '待複驗', '完成']);

function publicError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function clean(value, max = 100) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function requiredText(value, label, max = 100) {
  const result = clean(value, max);
  if (!result) throw publicError(400, `請填寫${label}`);
  return result;
}

function dateOnly(value, label) {
  const result = clean(value, 10);
  if (!DATE_RE.test(result) || new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) !== result) {
    throw publicError(400, `${label}格式不正確`);
  }
  return result;
}

function parentDataSourceId(page) {
  return page?.parent?.data_source_id || page?.parent?.database_id || '';
}

function propertyType(property) {
  if (property?.type) return property.type;
  return ['title', 'relation', 'select', 'rich_text', 'date'].find((type) => property?.[type]) || '';
}

function requireProperty(schema, name, type) {
  const property = schema?.properties?.[name];
  if (!property || propertyType(property) !== type) {
    throw publicError(409, `Notion 資料庫缺少「${name}」${type}欄位，請先完成資料庫升級`);
  }
  return property;
}

function optionalProperty(schema, name, type) {
  const property = schema?.properties?.[name];
  return property && propertyType(property) === type;
}

async function dataSourceSchema(deps, key, label) {
  const id = deps.dataSources?.[key];
  if (!id) throw publicError(503, `此工程租戶尚未設定${label}資料庫`);
  return deps.notionRequest(`/v1/data_sources/${encodeURIComponent(id)}`, { method: 'GET' });
}

async function ownedPage(deps, pageId, dataSourceId, label) {
  if (!pageId) throw publicError(400, `請選擇${label}`);
  const page = await deps.notionRequest(`/v1/pages/${encodeURIComponent(pageId)}`, { method: 'GET' });
  if (!sameId(parentDataSourceId(page), dataSourceId)) {
    throw publicError(400, `${label}不屬於目前工程租戶`);
  }
  return page;
}

export async function assertManagedProject(deps, scope, projectId) {
  const page = await ownedPage(deps, projectId, deps.dataSources?.projects, '案件');
  if (scope) {
    const code = plain(page.properties?.['館別代碼']?.rich_text);
    if (!scope.has(code)) throw publicError(403, '無此案件的管理權限');
  }
  return page;
}

function auditChildren(actor, label) {
  const who = clean(actor, 80) || '工程儀表板使用者';
  const stamp = new Date().toISOString();
  return [{
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: textFrag(`[工程儀表板建立] ${label}；建立者：${who}；時間：${stamp}`) },
  }];
}

export async function listProjectSpaces(deps, projectId) {
  if (!deps.dataSources?.spaces) return [];
  const pages = await queryAll(deps, deps.dataSources.spaces, {
    property: '專案', relation: { contains: projectId },
  });
  return pages.map((page) => ({
    id: page.id,
    name: plain(page.properties?.['名稱']?.title),
    zone: plain(page.properties?.['區/棟']?.rich_text),
    type: page.properties?.['類型']?.select?.name || '',
  })).filter((space) => space.name).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
}

export async function dashboardSetupOptions(deps, scope, projectId) {
  await assertManagedProject(deps, scope, projectId);
  const [spaces, trades] = await Promise.all([
    listProjectSpaces(deps, projectId),
    listKnownTrades(deps),
  ]);
  return { spaces, trades };
}

export async function createDashboardSpace(deps, scope, input = {}) {
  const projectId = clean(input.project, 80);
  const name = requiredText(input.name, '空間名稱');
  const zone = clean(input.zone, 100);
  const type = clean(input.type, 50);
  const alias = clean(input.alias, 500);
  await assertManagedProject(deps, scope, projectId);

  const [schema, existing] = await Promise.all([
    dataSourceSchema(deps, 'spaces', '空間'),
    listProjectSpaces(deps, projectId),
  ]);
  requireProperty(schema, '名稱', 'title');
  requireProperty(schema, '專案', 'relation');
  if (existing.some((space) => space.name.localeCompare(name, 'zh-Hant', { sensitivity: 'accent' }) === 0)) {
    throw publicError(409, `此案件已經有「${name}」空間`);
  }

  const properties = {
    '名稱': { title: textFrag(name) },
    '專案': { relation: [{ id: projectId }] },
  };
  if (zone && optionalProperty(schema, '區/棟', 'rich_text')) properties['區/棟'] = { rich_text: textFrag(zone) };
  if (type && optionalProperty(schema, '類型', 'select')) properties['類型'] = { select: { name: type } };
  if (alias && optionalProperty(schema, '別名', 'rich_text')) properties['別名'] = { rich_text: textFrag(alias) };

  const created = await deps.notionRequest('/v1/pages', {
    method: 'POST',
    body: {
      parent: { type: 'data_source_id', data_source_id: deps.dataSources.spaces },
      properties,
      children: auditChildren(deps.actor, `空間：${name}`),
    },
  });
  return { ok: true, id: created.id, url: created.url || '', name };
}

function safeSelectOptions(options = []) {
  return options.filter((option) => clean(option?.name)).map((option) => ({
    name: clean(option.name, 100),
    ...(clean(option.color, 30) ? { color: clean(option.color, 30) } : {}),
  }));
}

export async function createDashboardTrade(deps, input = {}) {
  const name = requiredText(input.name, '工種名稱', 50);
  const schema = await dataSourceSchema(deps, 'workItems', '工項');
  const tradeProperty = requireProperty(schema, '工種', 'select');
  const current = safeSelectOptions(tradeProperty.select?.options || []);
  const found = current.find((option) => option.name.toLocaleLowerCase('zh-Hant') === name.toLocaleLowerCase('zh-Hant'));
  if (found) return { ok: true, name: found.name, existed: true };

  await deps.notionRequest(`/v1/data_sources/${encodeURIComponent(deps.dataSources.workItems)}`, {
    method: 'PATCH',
    body: { properties: { '工種': { select: { options: [...current, { name }] } } } },
  });
  clearTradeCache(deps.tenantKey);
  return { ok: true, name, existed: false };
}

export async function createDashboardWorkItem(deps, scope, input = {}) {
  const projectId = clean(input.project, 80);
  const spaceId = clean(input.space, 80);
  const name = requiredText(input.name, '工項名稱');
  const trade = requiredText(input.trade, '工種', 50);
  const status = clean(input.status, 30) || '未開始';
  if (!WORK_ITEM_STATUSES.has(status)) throw publicError(400, '工項狀態不正確');
  const contractor = clean(input.contractor, 200);
  const start = dateOnly(input.plannedStart, '預計開始日');
  const end = dateOnly(input.plannedEnd, '預計完成日');
  if (start > end) throw publicError(400, '預計完成日不可早於預計開始日');

  await assertManagedProject(deps, scope, projectId);
  const [space, schema, existing] = await Promise.all([
    ownedPage(deps, spaceId, deps.dataSources?.spaces, '空間'),
    dataSourceSchema(deps, 'workItems', '工項'),
    queryAll(deps, deps.dataSources.workItems, { property: '專案', relation: { contains: projectId } }),
  ]);
  const spaceProjectId = space.properties?.['專案']?.relation?.[0]?.id || '';
  if (!sameId(spaceProjectId, projectId)) throw publicError(400, '所選空間不屬於目前案件');

  requireProperty(schema, '工項', 'title');
  requireProperty(schema, '專案', 'relation');
  requireProperty(schema, '空間', 'relation');
  requireProperty(schema, '工種', 'select');
  requireProperty(schema, '狀態', 'select');
  requireProperty(schema, '預計開始', 'date');
  requireProperty(schema, '預計完成', 'date');

  const duplicate = existing.some((page) => {
    const sameName = plain(page.properties?.['工項']?.title).localeCompare(name, 'zh-Hant', { sensitivity: 'accent' }) === 0;
    const existingSpace = page.properties?.['空間']?.relation?.[0]?.id || '';
    return sameName && sameId(existingSpace, spaceId);
  });
  if (duplicate) throw publicError(409, `此空間已經有「${name}」工項`);

  const properties = {
    '工項': { title: textFrag(name) },
    '專案': { relation: [{ id: projectId }] },
    '空間': { relation: [{ id: spaceId }] },
    '工種': { select: { name: trade } },
    '狀態': { select: { name: status } },
    '預計開始': { date: { start } },
    '預計完成': { date: { start: end } },
  };
  if (contractor && optionalProperty(schema, '負責工班', 'rich_text')) {
    properties['負責工班'] = { rich_text: textFrag(contractor) };
  }

  const created = await deps.notionRequest('/v1/pages', {
    method: 'POST',
    body: {
      parent: { type: 'data_source_id', data_source_id: deps.dataSources.workItems },
      properties,
      children: auditChildren(deps.actor, `工項：${name}`),
    },
  });
  clearTradeCache(deps.tenantKey);
  return { ok: true, id: created.id, url: created.url || '', name, start, end };
}

export const __test = { clean, dateOnly, safeSelectOptions };
