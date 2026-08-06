// 一對一 LINE 事件入口。
// 這一層只做身分解析與安全分流；不把私人訊息交給原本的群組 collect/triage 流程。

function directSource(event) {
  const source = event?.source || {};
  return source.type === 'user' && source.userId && !source.groupId && !source.roomId;
}

function unresolvedMessage(reason) {
  if (reason === 'ambiguous') {
    return '⚠️ 你的 LINE 身分目前對應到多個工作空間，為避免資料混用，葉小蝸暫不提供私人資料。請聯絡管理者確認唯一歸屬。';
  }
  if (reason === 'lookup_failed') {
    return '⚠️ 葉小蝸目前無法安全確認你的工作身分，請稍後再試。這次訊息不會寫入任何專案。';
  }
  return '尚未完成 HOZO 私人助理身分綁定。請先在已啟用的 HOZO 工作群組傳送一則訊息，或請管理者確認群組的成員對照。';
}

async function safeReply(replyLineMessage, event, message, logger) {
  if (!event?.replyToken || typeof replyLineMessage !== 'function') return false;
  try {
    await replyLineMessage(event.replyToken, message);
    return true;
  } catch (error) {
    logger?.warn?.(`Direct LINE reply failed: ${error.message}`);
    return false;
  }
}

export async function routeDirectLineEvent({
  event,
  router,
  dispatcher,
  replyLineMessage,
  logger = console,
}) {
  if (!directSource(event)) return { matched: false };

  const userId = String(event.source.userId || '').trim();
  const resolved = await router.resolveDirectBinding(userId);
  if (!resolved?.tenant || !resolved?.binding) {
    await safeReply(replyLineMessage, event, unresolvedMessage(resolved?.reason), logger);
    return { matched: true, routed: false, reason: resolved?.reason || 'not_found' };
  }

  if (event.type === 'follow') {
    const displayName = resolved.binding.displayName || '夥伴';
    await safeReply(
      replyLineMessage,
      event,
      `✅ ${displayName}，已確認你的 ${resolved.tenant.displayName} 身分。你現在可以在這裡使用葉小蝸私人助理。`,
      logger,
    );
    return { matched: true, routed: true, reason: 'bound', tenant: resolved.tenant };
  }

  if (event.type !== 'message' || !event.message) {
    return { matched: true, routed: false, reason: 'unsupported_event' };
  }

  const handled = await dispatcher.dispatchDirectMessage({
    tenant: resolved.tenant,
    personalBinding: resolved.binding,
    event,
  });
  if (!handled) {
    await safeReply(
      replyLineMessage,
      event,
      `✅ 已確認你的 ${resolved.tenant.displayName} 身分；私人助理功能正在啟用中。這次訊息不會進入群組任務判斷。`,
      logger,
    );
  }
  return { matched: true, routed: true, handled, reason: 'bound', tenant: resolved.tenant };
}

export { directSource, unresolvedMessage };
