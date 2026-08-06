// 葉小蝸一對一私人助理的第一階段入口。
// 本版只證明身分與私人路由已成立，不查詢或改寫任務；後續 Calendar 功能從此 hook 擴充。

let platform;

function identityLabel(ctx) {
  return ctx.personalBinding?.displayName || ctx.senderName || '夥伴';
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
    if (!ctx.event?.replyToken) return false;
    await platform.replyLineMessage(ctx.event.replyToken, responseFor(ctx));
    return true;
  },
  routes: [],
};

export { responseFor };
