// Temporary LINE reply hook for live HOZO AM smoke tests.
// It replies only to explicit HOZO AM test prompts and lets normal modules continue.

let platform = null;

function init(injected) {
  platform = injected;
}

function isHozoTestPrompt(text) {
  const normalized = String(text || '').replace(/\s+/g, '').toLowerCase();
  if (!normalized) return false;
  const namesHozoAm = normalized.includes('hozoam');
  const asksForReply = /測試|收到|回覆|回我|test|reply/.test(normalized);
  return namesHozoAm && asksForReply;
}

async function onMessage(ctx) {
  if (ctx.tenant?.key !== 'hozo-am-2-0') return false;
  if (ctx.message?.type !== 'text') return false;
  if (!isHozoTestPrompt(ctx.text)) return false;

  const replyToken = ctx.event?.replyToken || '';
  if (!replyToken || typeof platform?.replyLineMessage !== 'function') {
    platform?.logger?.warn?.(`[test-reply] cannot reply (tenant=${ctx.tenant.key}, group=${ctx.groupId || 'direct'}): missing replyToken or LINE helper.`);
    return false;
  }

  try {
    await platform.replyLineMessage(replyToken, '收到了');
    platform.logger?.log?.(`[test-reply] replied to HOZO AM test prompt (tenant=${ctx.tenant.key}, group=${ctx.groupId || 'direct'}).`);
  } catch (error) {
    platform.logger?.warn?.(`[test-reply] reply failed (tenant=${ctx.tenant.key}, group=${ctx.groupId || 'direct'}): ${error.message}`);
  }
  return false;
}

export default {
  name: 'test-reply',
  init,
  onMessage,
};

export const __test = { isHozoTestPrompt };
