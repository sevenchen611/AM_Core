import { isClaimsCommand } from './claims-authority.js';

const UNBOUND_MESSAGE = '此群尚未完成請款授權設定，請管理者完成群組綁定後再試。';
const IDENTITY_MESSAGE = '目前無法安全確認你的請款身份，請在已啟用請款的群組重新傳送指令，或聯絡管理者。';
const DENIED_MESSAGE = '此群組或你的請款權限目前尚未啟用，請聯絡管理者確認。';

export function createClaimsAuthorityRuntimeAdapter({ authority, replyLine } = {}) {
  if (!authority?.handleEvent || typeof replyLine !== 'function') {
    throw new Error('Claims authority runtime dependencies are incomplete.');
  }
  return {
    async handle({ tenant, binding, event }) {
      const result = await authority.handleEvent({ tenant, binding, event });
      if (!isClaimsCommand(event?.message?.text)) return result;
      if (result.state === 'unassigned') {
        await replyLine(event, UNBOUND_MESSAGE);
        return { ...result, userMessage: 'unbound' };
      }
      if (result.claim?.reason === 'identity_unavailable') {
        await replyLine(event, IDENTITY_MESSAGE);
        return { ...result, userMessage: 'identity_unavailable' };
      }
      if (result.mode === 'enforce' && result.claim && !result.claim.ok) {
        await replyLine(event, DENIED_MESSAGE);
        return { ...result, userMessage: 'not_ready_or_denied' };
      }
      return result;
    },
  };
}

export const claimsAuthorityFallbackMessages = Object.freeze({
  unbound: UNBOUND_MESSAGE,
  identityUnavailable: IDENTITY_MESSAGE,
  denied: DENIED_MESSAGE,
});
