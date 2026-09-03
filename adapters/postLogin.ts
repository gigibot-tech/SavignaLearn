/**
 * Post-sign-in destination. AuthGate unmounts the navigator while logged out,
 * so Expo Router remounts on the previous URL (often Settings). Fresh sign-in
 * opens SavignasBoi instead of that stale screen or the invite empty-home.
 */

export function learningBotHref(conversationId: string): `/chat/${string}` {
  return `/chat/${conversationId}`;
}

export function profileHref(userId: string, conversationId?: string): string {
  const path = `/u/${encodeURIComponent(userId)}`;
  return conversationId ? `${path}?chat=${encodeURIComponent(conversationId)}` : path;
}

export function routeParam(value: string | string[] | undefined, fallback: string): string {
  if (Array.isArray(value)) return value[0] || fallback;
  return value || fallback;
}

export function needsPostLoginBotRedirect(pathname: string, conversationId: string): boolean {
  if (pathname === learningBotHref(conversationId)) return false;
  if (pathname.startsWith('/u/')) return false;
  return true;
}
