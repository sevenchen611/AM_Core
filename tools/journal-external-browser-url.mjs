// The origin and any preserved query keys must be explicitly confirmed by the installer.
export function externalJournalUrl(input, { allowedOrigin, allowedQueryKeys = [] } = {}) {
  const url = new URL(input);
  const origin = new URL(allowedOrigin);
  if (url.protocol !== 'https:' || origin.protocol !== 'https:' || url.origin !== origin.origin
      || url.username || url.password || origin.username || origin.password
      || origin.pathname !== '/' || origin.search || origin.hash
      || ['localhost', '127.0.0.1', '[::1]', 'liff.line.me', 'miniapp.line.me', 'line.me'].includes(url.hostname)) {
    throw new Error('Confirm the direct public HTTPS journal origin before creating an external-browser link.');
  }
  const allowed = new Set(allowedQueryKeys);
  for (const key of url.searchParams.keys()) {
    if (['openExternalBrowser', 'openInAppBrowser'].includes(key)) continue;
    if (/(token|secret|password|session|credential|authorization|account|user.?id|line.?id|auth|code|key)/i.test(key)
        || !allowed.has(key)) throw new Error('Unconfirmed or sensitive journal query parameter.');
  }
  url.searchParams.delete('openInAppBrowser');
  url.searchParams.set('openExternalBrowser', '1');
  return url.href;
}
