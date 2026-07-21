const ALLOWED_PORTAL_RETURN_PATHS = new Set(['/meetings/manage', '/admin']);

export function safePortalHandoffLocation(rawNext, tenantKey, fallback = '/') {
  const raw = String(rawNext || '').trim();
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback;
  try {
    const next = new URL(raw, 'https://am-platform.invalid');
    if (next.origin !== 'https://am-platform.invalid' || !ALLOWED_PORTAL_RETURN_PATHS.has(next.pathname)) return fallback;
    next.searchParams.set('tenant', String(tenantKey || ''));
    return `${next.pathname}${next.search}`;
  } catch {
    return fallback;
  }
}

export const __test = { ALLOWED_PORTAL_RETURN_PATHS };
