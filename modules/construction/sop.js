// SOP 階段檢核(SOP-01 v1.0 各階段完成定義)
// 資料(SOP_STAGES)與檢核狀態(存專案頁「SOP檢核」rich_text 的 JSON)由 construction 擁有;
// dashboard 模組只負責呈現與勾選 UI,資料/讀寫一律呼叫這裡(供 dashboard 的 SOP 資料)。
// 抽自 BuildAM src/dashboard.js 的 SOP_STAGES 與 /dashboard/api/sop-check。

import { plain } from './common.js';

export const SOP_STAGES = [
  { title: '階段① 審圖與圖面定版', items: [
    { id: 's1a', text: '全套圖面逐張審閱,問題全數開立回饋單' },
    { id: 's1b', text: '關鍵尺寸現場複核(牆厚/牆體工法/隔音/浴室/管道間/樑柱/門窗)' },
    { id: 's1c', text: 'A/B 級回饋單全數銷項(或轉核准變更單)' },
    { id: 's1d', text: 'PM 拍板圖面凍結(估價版標註版本日期)' },
  ] },
  { title: '階段② 發包', items: [
    { id: 's2a', text: '各工種現場說明會完成(所有報價工班都聽過)' },
    { id: 's2b', text: '每工種 2~3 家報價到齊並比較,PM 決標' },
    { id: 's2c', text: '得標工班取得凍結版圖面與範圍確認' },
    { id: 's2d', text: '議價變動已開變更單並核准' },
  ] },
  { title: '階段③ 進場交底與開工', items: [
    { id: 's3a', text: '各進場工種完成施工交底(對實際進場人員)' },
    { id: 's3b', text: '進場順序交代(拆除清場→水電→木工→泥作)與界面記錄' },
    { id: 's3c', text: '開工條件檢核通過(前置完成/材料到位)' },
    { id: 's3d', text: '開工日公告至工班群' },
  ] },
];

// 讀某專案的 SOP 檢核狀態(供 dashboard 呈現)
export async function readSopState(deps, projectId) {
  if (!projectId) throw new Error('projectId required');
  const page = await deps.notionRequest(`/v1/pages/${encodeURIComponent(projectId)}`, { method: 'GET' });
  let state = {};
  try { state = JSON.parse(plain(page.properties['SOP檢核']?.rich_text)) || {}; } catch {}
  return { stages: SOP_STAGES, state };
}

// 勾/取消某條 SOP 項目(dashboard 勾選時呼叫)
export async function writeSopCheck(deps, projectId, itemId, checked) {
  if (!projectId || !itemId) throw new Error('project/itemId required');
  const page = await deps.notionRequest(`/v1/pages/${encodeURIComponent(projectId)}`, { method: 'GET' });
  let state = {};
  try { state = JSON.parse(plain(page.properties['SOP檢核']?.rich_text)) || {}; } catch {}
  state[itemId] = Boolean(checked);
  await deps.notionRequest(`/v1/pages/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    body: { properties: { 'SOP檢核': { rich_text: [{ type: 'text', text: { content: JSON.stringify(state).slice(0, 1900) } }] } } },
  });
  return { ok: true, state };
}
