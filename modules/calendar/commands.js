const QUERY_PATTERNS = [
  /^(?:我的)?(?:今天|今日)(?:行程|工作|待辦)?[？?]?$/u,
  /^(?:我的)?行程[？?]?$/u,
  /^昨天未完(?:成)?[？?]?$/u,
  /^(?:我的)?這週(?:行程|工作|待辦)?[？?]?$/u,
];

export function isCalendarCommand(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (QUERY_PATTERNS.some((pattern) => pattern.test(text))) return true;
  return /^(?:新增|安排)(?:工作|行程|待辦)?\s+/u.test(text)
    || /^(?:確認新增|取消新增)$/u.test(text)
    || /^(?:完成|取消|刪除)\s*\d+$/u.test(text)
    || /^(?:延到明天|改期)\s*\d+(?:\s+\S+)?$/u.test(text)
    || /^提醒我\s*\d+\s+\S+/u.test(text);
}
export function queryKind(value) {
  const text = String(value || '').trim();
  if (/^昨天未完/u.test(text)) return 'yesterday';
  if (/這週/u.test(text)) return 'week';
  return QUERY_PATTERNS.some((pattern) => pattern.test(text)) ? 'today' : '';
}
