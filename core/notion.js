// AM Platform core — Notion API + per-tenant 資料隔離守衛
// 比照 BuildAM assertBuildNotionTarget,但改為「每個資料源自我識別所屬租戶」的多租戶版:
//   1. 任何寫入/查詢的目標資料源,必須是某租戶在 .env 宣告過的(否則拒絕)。
//   2. 該資料源的 database 必須位於「宣告它的那個租戶」的母頁下(否則拒絕)。
// 這保證平台不會寫到宣告外的地方;而各模組只從 ctx.tenant.dataSources 拿到自己租戶的 id,
// 結構上就碰不到別的租戶的庫(A 租戶不可碰 B 租戶庫)。

import { normalizeId } from './util.js';

export function createNotion({ token, version, registry, logger = console }) {
  // 已通過「位於母頁下」驗證的資料源(normalizeId → true),避免每次都打 metadata。
  const verified = new Map();
  // 已驗證的既有頁面(page id → data source id)。網頁後臺會 PATCH 既有的群組綁定頁，
  // 因此不能只守住「新建頁」的 parent；也要確認被改的頁確實屬於該租戶宣告的資料源。
  const verifiedPages = new Map();

  async function notionFetchJson(pathname) {
    const response = await fetch(`https://api.notion.com${pathname}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': version },
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`Notion API failed: ${response.status} ${responseText}`);
    }
    return responseText ? JSON.parse(responseText) : {};
  }

  // 從 request 抽出所有「目標資料源 id」(查詢路徑 + body.parent),逐一過守衛。
  async function assertTenantNotionTarget(pathname, body, opts) {
    const dataSourceIds = new Set();
    const dataSourceMatch = String(pathname || '').match(/^\/v1\/data_sources\/([^/]+)\/query(?:\?|$)/);
    if (dataSourceMatch?.[1]) dataSourceIds.add(decodeURIComponent(dataSourceMatch[1]));
    const dataSourceTargetMatch = String(pathname || '').match(/^\/v1\/data_sources\/([^/?]+)(?:\?|$)/);
    if (dataSourceTargetMatch?.[1]) dataSourceIds.add(decodeURIComponent(dataSourceTargetMatch[1]));
    const parent = body?.parent;
    if (parent?.type === 'data_source_id' && parent.data_source_id) dataSourceIds.add(parent.data_source_id);

    for (const dataSourceId of dataSourceIds) {
      await assertDataSource(dataSourceId, opts);
    }

    const pageMatch = String(pathname || '').match(/^\/v1\/pages\/([^/?]+)(?:\?|$)/);
    if (pageMatch?.[1]) await assertPage(decodeURIComponent(pageMatch[1]), opts);
  }

  async function assertDataSource(dataSourceId, opts) {
    const norm = normalizeId(dataSourceId);
    const owner = registry.get(norm);
    if (!owner) {
      throw new Error(`Refusing to access Notion data source outside any tenant configuration: ${dataSourceId}.`);
    }
    // 選用的嚴格綁定:core 內部呼叫可指定 opts.tenantKey,要求目標必須屬於該租戶。
    if (opts?.tenantKey && owner.tenant.key !== opts.tenantKey) {
      throw new Error(`Cross-tenant Notion access blocked: data source ${dataSourceId} belongs to ${owner.tenant.key}, not ${opts.tenantKey}.`);
    }
    if (verified.has(norm)) return;

    const parentPageId = owner.tenant.parentPageId;
    const dataSource = await notionFetchJson(`/v1/data_sources/${encodeURIComponent(dataSourceId)}`);
    const databaseId = dataSource.parent?.database_id;
    if (!databaseId) {
      throw new Error(`Notion data source ${dataSourceId} is not attached to a database.`);
    }
    const database = await notionFetchJson(`/v1/databases/${encodeURIComponent(databaseId)}`);
    if (dataSource.archived || dataSource.in_trash || database.archived || database.in_trash) {
      throw new Error(`Refusing to write to archived or trashed Notion data source: ${dataSourceId}.`);
    }
    // 2025-09-03 將資料源與 database 分離；優先使用 data source 回傳的 database_parent，
    // 保留 database.parent 作為舊回應形狀的相容 fallback。
    const databaseParentId = normalizeId(
      dataSource.database_parent?.page_id || dataSource.database_parent?.block_id
      || database.parent?.page_id || database.parent?.block_id || '',
    );
    if (parentPageId && databaseParentId !== parentPageId) {
      throw new Error(`Refusing to write outside tenant ${owner.tenant.key} Notion page area: ${databaseId}.`);
    }
    verified.set(norm, true);
  }

  async function assertPage(pageId, opts) {
    const cachedDataSourceId = verifiedPages.get(normalizeId(pageId));
    if (cachedDataSourceId) {
      await assertDataSource(cachedDataSourceId, opts);
      return;
    }
    const page = await notionFetchJson(`/v1/pages/${encodeURIComponent(pageId)}`);
    const parent = page?.parent || {};
    // 2025-09-03 起頁面 parent 會帶 data_source_id；沒有它就無法證明頁面屬於某個租戶資料表。
    const dataSourceId = parent.data_source_id || (parent.type === 'data_source_id' ? parent.data_source_id : '');
    if (!dataSourceId) {
      throw new Error(`Refusing to access Notion page without a data source parent: ${pageId}.`);
    }
    await assertDataSource(dataSourceId, opts);
    verifiedPages.set(normalizeId(pageId), dataSourceId);
  }

  // 共用能力:模組經 platform.notionRequest(pathname, { method, body }) 呼叫,一律先過隔離守衛。
  // opts.tenantKey(選用):core 內部強制綁定某租戶;模組通常省略(靠 ctx.tenant 只給自家 id 達成隔離)。
  async function notionRequest(pathname, { method, body, tenantKey } = {}) {
    if (!token) throw new Error('NOTION_TOKEN is not set.');
    await assertTenantNotionTarget(pathname, body, { tenantKey });
    const response = await fetch(`https://api.notion.com${pathname}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Notion-Version': version },
      body: body ? JSON.stringify(body) : undefined,
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`Notion API failed: ${response.status} ${responseText}`);
    }
    return responseText ? JSON.parse(responseText) : {};
  }

  // 上傳檔案到 Notion(附件用),沿用 BuildAM 流程。
  async function uploadFileToNotion(buffer, filename, contentType) {
    const upload = await notionRequest('/v1/file_uploads', { method: 'POST', body: { filename, content_type: contentType } });
    const formData = new FormData();
    formData.append('file', new Blob([buffer], { type: contentType }), filename);
    const response = await fetch(upload.upload_url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': version },
      body: formData,
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`Notion file upload failed: ${response.status} ${responseText}`);
    }
    const result = responseText ? JSON.parse(responseText) : upload;
    if (result.status && result.status !== 'uploaded') {
      throw new Error(`Notion file upload status is ${result.status}`);
    }
    return result.id ? result : upload;
  }

  return { notionRequest, uploadFileToNotion };
}
