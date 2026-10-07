// Public navigation only. DailyLog keeps its own login and access checks.
export const WORK_JOURNAL_ENTRY_CONTRACT = 'line-work-journal-rich-menu-entry-v1';

export function isWorkJournalEvent(event) {
  const source = event?.source;
  const text = String(event?.message?.text || '').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  return event?.type === 'message' && event.message?.type === 'text'
    && source?.type === 'user' && /^U[0-9a-f]{32}$/i.test(source.userId || '')
    && !source.groupId && !source.roomId
    && ['工作日誌', '開啟工作日誌', '打開工作日誌'].includes(text);
}

export function workJournalAction(menu) {
  const actions = (menu?.areas || []).map(area => area.action).filter(action => action?.type === 'uri' && action.label === '工作日誌');
  if (actions.length !== 1) throw new Error('work_journal_menu_unavailable');
  const uri = actions[0].uri;
  const url = new URL(uri);
  if (url.protocol !== 'https:' || url.username || url.password || ['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error('work_journal_menu_invalid');
  // Preserve the deployed menu URI exactly, including external browser behavior.
  return { type: 'uri', label: '開啟工作日誌', uri };
}

export function createWorkJournalEntry({ line, logger = console }) {
  const menus = new Map();
  async function actionFor(userId) {
    let association;
    try { association = await line.lineGet(`/v2/bot/user/${encodeURIComponent(userId)}/richmenu`, { timeoutMs: 3000 }); }
    catch (error) {
      if (error.lineStatus !== 404) throw error;
      association = await line.lineGet('/v2/bot/user/all/richmenu', { timeoutMs: 3000 });
    }
    const id = association?.richMenuId;
    if (!/^richmenu-[0-9a-f]{32}$/i.test(id || '')) throw new Error('work_journal_menu_unavailable');
    // Menu definitions are immutable. Recheck the active association on each
    // command; cache only definitions, with no user IDs, tokens or journal data.
    if (!menus.has(id)) {
      if (menus.size >= 64) menus.delete(menus.keys().next().value);
      const pending = line.lineGet(`/v2/bot/richmenu/${id}`, { timeoutMs: 3000 }).then(workJournalAction);
      menus.set(id, pending);
      pending.catch(() => { if (menus.get(id) === pending) menus.delete(id); });
    }
    return menus.get(id);
  }
  async function handle(event) {
    if (!isWorkJournalEvent(event)) return false;
    if (!event.replyToken || event.mode === 'standby') return true;
    let message;
    try {
      const action = await actionFor(event.source.userId);
      message = { type: 'template', altText: '開啟工作日誌', template: { type: 'buttons', text: '點選下方按鈕開啟工作日誌。', actions: [action] } };
    } catch {
      logger.warn?.('Work journal menu lookup unavailable.');
      message = { type: 'text', text: '目前無法取得工作日誌入口，請點下方選單的「工作日誌」，或稍後再輸入「工作日誌」。' };
    }
    try { await line.replyLineMessages(event.replyToken, [message], { timeoutMs: 5000 }); }
    catch { logger.warn?.('Work journal entry reply unavailable.'); }
    return true;
  }
  return { matches: isWorkJournalEvent, handle, health: () => ({ contract: WORK_JOURNAL_ENTRY_CONTRACT, commands: ['工作日誌', '開啟工作日誌', '打開工作日誌'], source: 'active-rich-menu', scope: 'direct-chat-navigation' }) };
}
