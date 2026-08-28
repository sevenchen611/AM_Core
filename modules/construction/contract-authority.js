import { plain, sameId } from './common.js';

function authorityError(message, statusCode = 403) {
  return Object.assign(new Error(message), { statusCode });
}

export async function resolveAuthoritativeSigningGroup(deps, { groupBindingId, projectId, signerLineUserId }) {
  if (!groupBindingId || !projectId || !signerLineUserId) throw authorityError('缺少簽署群組、工程專案或指定簽署人', 400);
  if (!deps.dataSources.groupBindings) throw authorityError('群組綁定資料庫尚未設定', 503);
  const page = await deps.notionRequest(`/v1/pages/${encodeURIComponent(groupBindingId)}`, { method: 'GET' });
  if (!sameId(page.parent?.data_source_id, deps.dataSources.groupBindings)) throw authorityError('不是工程 AM 的群組綁定');
  const projects = page.properties?.['專案']?.relation || [];
  if (!projects.some((item) => sameId(item.id, projectId))) throw authorityError('簽署群組不屬於這個工程專案');
  const status = page.properties?.['狀態']?.select?.name || '';
  if (status !== '啟用') throw authorityError('簽署群組目前未啟用', 409);
  const lineGroupId = plain(page.properties?.['LINE 群組 ID']?.rich_text);
  if (!lineGroupId) throw authorityError('簽署群組尚未取得 LINE 群組 ID', 409);
  let members = {};
  try { members = JSON.parse(plain(page.properties?.['成員對照']?.rich_text)) || {}; } catch { members = {}; }
  const signer = Object.entries(members).find(([, userId]) => String(userId) === String(signerLineUserId));
  if (!signer) throw authorityError('指定簽署人不在這個 LINE 群組的最新成員對照中', 409);
  return {
    groupBindingId: page.id,
    lineGroupId,
    signerLineUserId: String(signer[1]),
    signerName: String(signer[0]),
    groupName: plain(page.properties?.['群組名稱']?.title),
  };
}

