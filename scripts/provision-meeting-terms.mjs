// 建立一個 AM 租戶專屬的「會議名詞庫」Notion 資料庫。
// 用法：node --env-file=.env scripts/provision-meeting-terms.mjs <tenant-key>
// 成功後只輸出要加到該部署環境的 <PREFIX>_MEETING_TERMS_DATA_SOURCE_ID，不輸出任何機密。

import { loadTenants } from '../core/tenants.js';

const tenantKey = String(process.argv[2] || '').trim();
const tenant = loadTenants(process.env, console).find((item) => item.key === tenantKey);
if (!tenant) throw new Error('請指定已登記的 tenant key。');
if (!tenant.parentPageId) throw new Error(`${tenant.key} 尚未設定 Notion 母頁。`);
if (!process.env.NOTION_TOKEN) throw new Error('NOTION_TOKEN is not set.');
if (tenant.dataSources.meetingTerms) throw new Error(`${tenant.key} 已設定會議名詞庫，未建立重複資料庫。`);

const response = await fetch('https://api.notion.com/v1/databases', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
    'Content-Type': 'application/json',
    'Notion-Version': process.env.NOTION_VERSION || '2025-09-03',
  },
  body: JSON.stringify({
    parent: { type: 'page_id', page_id: tenant.parentPageId },
    title: [{ type: 'text', text: { content: `AM 會議名詞庫 · ${tenant.displayName}` } }],
    initial_data_source: {
      properties: {
        '名詞': { title: {} },
        '類型': { select: { options: ['人名', '部門／職稱', '館別／案場', '系統／品牌', '其他'].map((name) => ({ name })) } },
        '狀態': { select: { options: ['已啟用', '停用', '待確認'].map((name) => ({ name })) } },
        '來源': { select: { options: ['手動', 'AI 候選'].map((name) => ({ name })) } },
        '說明': { rich_text: {} },
      },
    },
  }),
});
const result = await response.json();
if (!response.ok) throw new Error(`Notion 建立失敗：${response.status} ${JSON.stringify(result).slice(0, 500)}`);
const id = result.data_sources?.[0]?.id || result.data_sources?.[0]?.data_source_id;
if (!id) throw new Error('Notion 未回傳 data source id。');
console.log(`${tenant.envPrefix}_MEETING_TERMS_DATA_SOURCE_ID=${id}`);
