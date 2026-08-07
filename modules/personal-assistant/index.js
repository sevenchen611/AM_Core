// 葉小蝸一對一私人助理的第一階段入口。
// 本版處理正式 LINE ↔ Rental Portal 身分綁定，並把功能指令交給對應模組；
// 不在私人助理 fallback 內查詢或改寫任務。

let platform;

const DELEGATED_COMMANDS = new Set(['請款', '我要請款', '請款按鈕', '開啟請款', '#請款']);

function isDelegatedCommand(value) {
  const text = String(value || '').trim();
  return DELEGATED_COMMANDS.has(text) || /^#請款\s+[\s\S]+$/u.test(text);
}

function identityLabel(ctx) {
  return ctx.personalBinding?.displayName || ctx.senderName || '夥伴';
}

function parseBindingCommand(text) {
  const match = String(text || '').trim().match(/^綁定\s+(\d{6})[？?]?$/u);
  return match ? { code: match[1] } : null;
}

function isRevokeBindingCommand(text) {
  return /^(?:解除|撤銷)(?:LINE)?(?:身分|綁定)[？?]?$/u.test(String(text || '').trim());
}

function bindingRequestId(ctx) {
  const eventId = ctx.event?.webhookEventId || ctx.event?.eventId || ctx.message?.id || '';
  return `line-binding:${String(eventId || crypto.randomUUID())}`;
}

function bindingFailureMessage(result) {
  if (result?.status === 401) return '⚠️ 綁定碼已過期或無效，請回到 Rental Portal 重新產生一次性綁定碼。';
  if (result?.status === 409) return '⚠️ 這個 LINE 或 Portal 帳號已有其他有效綁定，為避免身分混用，這次沒有變更。';
  if (result?.status === 503) return '⚠️ Calendar 身分綁定服務目前尚未就緒，請稍後再試。';
  return '⚠️ 身分綁定沒有完成，請稍後再試或聯絡管理者。';
}

function bindingSuccessMessage(result) {
  const name = result?.displayName || '你的 Portal 帳號';
  return `✅ 已綁定到 HOZO Rental 帳號「${name}」。\n之後 Calendar 私人資料會依這個 Portal 身分授權。`;
}

function responseFor(ctx) {
  const name = identityLabel(ctx);
  const tenant = ctx.tenant?.displayName || 'HOZO';
  if (/^(?:我的)?(?:身分|綁定狀態|我是誰)[？?]?$/u.test(String(ctx.text || '').trim())) {
    return `✅ ${name}，你的 LINE 已綁定到 ${tenant}。\n身分來源：已啟用工作群組的 LINE user ID。`;
  }
  return `✅ ${name}，已用你的 ${tenant} 身分進入葉小蝸私人助理。\n\n一對一私人路由已啟用；這則訊息不會進入公司群組或其他租戶。\n「我的今天」、個人待辦與行事曆查詢會從這個入口接續開放。`;
}

export default {
  name: 'personal-assistant',
  init(sharedPlatform) {
    platform = sharedPlatform;
  },
  async onDirectMessage(ctx) {
    if (ctx.tenant?.config?.personalAssistant?.enabled !== true) return false;
    // Feature commands must continue through the direct-message dispatcher.
    // The personal assistant is the friendly fallback, not a catch-all that
    // prevents claims/calendar modules from handling their own commands.
    if (isDelegatedCommand(ctx.text)) return false;
    if (!ctx.event?.replyToken) return false;
    const binding = parseBindingCommand(ctx.text);
    if (binding) {
      if (!platform?.calendarIntegrationConfigured || typeof platform.calendarBindingConsume !== 'function') {
        await platform.replyLineMessage(ctx.event.replyToken, '⚠️ Rental Calendar 身分綁定尚未設定完成，這次沒有寫入任何資料。');
        return true;
      }
      const result = await platform.calendarBindingConsume({
        tenantKey: ctx.tenant.key,
        code: binding.code,
        lineUserId: ctx.directUserId,
        idempotencyKey: bindingRequestId(ctx),
      });
      await platform.replyLineMessage(ctx.event.replyToken, result?.ok ? bindingSuccessMessage(result) : bindingFailureMessage(result));
      return true;
    }
    if (isRevokeBindingCommand(ctx.text)) {
      await platform.replyLineMessage(ctx.event.replyToken, '請登入 HOZO Rental Portal 的個人設定，在「LINE 私人助理綁定」執行撤銷；葉小蝸不會直接替你撤銷帳號身分。');
      return true;
    }
    await platform.replyLineMessage(ctx.event.replyToken, responseFor(ctx));
    return true;
  },
  routes: [],
};

export {
  bindingFailureMessage,
  bindingSuccessMessage,
  isDelegatedCommand,
  isRevokeBindingCommand,
  parseBindingCommand,
  responseFor,
};
