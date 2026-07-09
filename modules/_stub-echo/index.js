// AM Platform 模組:_stub-echo(驗證用回聲樁)
// 目的:證明「路由器→租戶解析→ctx→落各自 Notion 頁」這條底座管線可通、且 per-tenant 隔離成立。
// onMessage 只做兩件事:把訊息寫進「當前租戶」的訊息庫、對群回一句回聲。不含任何業務邏輯。
// 正式模組(collect/queue/meetings…)上線後即可移除此樁。

import { textItem, mapMessageType } from '../../core/util.js';

let platform = null;
function init(injected) { platform = injected; }

async function onMessage(ctx) {
  const { tenant, groupId, senderName, message, text, binding, isMaster } = ctx;
  const messagesDs = tenant.dataSources.messages;
  if (!messagesDs) return false;

  const messageType = mapMessageType(message.type);
  const title = text ? text.slice(0, 60) : `[${messageType}] ${senderName}`;
  const properties = {
    '訊息': { title: [textItem(title)] },
    '內容': { rich_text: text ? [textItem(text.slice(0, 1900))] : [] },
    'LINE 群組 ID': { rich_text: groupId ? [textItem(groupId)] : [] },
    'LINE 訊息 ID': { rich_text: message.id ? [textItem(String(message.id))] : [] },
    '發送者': { rich_text: [textItem(senderName)] },
    '訊息類型': { select: { name: messageType } },
    '掛載狀態': { select: { name: '未掛載' } },
  };
  if (binding?.pageId) properties['群組綁定'] = { relation: [{ id: binding.pageId }] };
  if (binding?.projectPageId && !isMaster) properties['專案'] = { relation: [{ id: binding.projectPageId }] };

  // 一律經 platform.notionRequest → per-tenant 隔離守衛;目標庫來自 ctx.tenant,碰不到別租戶。
  const page = await platform.notionRequest('/v1/pages', {
    method: 'POST',
    body: { parent: { type: 'data_source_id', data_source_id: messagesDs }, properties },
  });

  if (groupId) {
    await platform.pushLineMessage(groupId, `🐌 [${tenant.displayName}] 收到:${title}`).catch(() => {});
  }
  platform.logger.log(`[stub-echo] tenant=${tenant.key} stored message ${message.id} → page ${page.id}`);
  return false; // 不短路,讓後續模組(若有)也能處理
}

export default {
  name: '_stub-echo',
  init,
  onMessage,
};
