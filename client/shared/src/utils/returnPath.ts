/**
 * Where to go after signing in.
 *
 * A protected route that finds nobody signed in sends the person to `/login`
 * and records where they were going in the router state. Without this, sign-in
 * always landed on the dashboard, so a clinician who opened a link to one
 * patient's note had to find it again by hand.
 *
 * The recorded location is only honoured when it is a path inside this app:
 * an absolute or protocol-relative URL could send a person somewhere else
 * entirely, and the sign-in and activation pages would loop.
 */
const PUBLIC_PATHS = ['/login', '/activate'];

interface RecordedLocation {
  pathname?: unknown;
  search?: unknown;
  hash?: unknown;
}

export function returnPathFrom(state: unknown, fallback = '/dashboard'): string {
  const from = (state as { from?: RecordedLocation } | null | undefined)?.from;
  const pathname = typeof from?.pathname === 'string' ? from.pathname : '';
  if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname.includes('\\')) return fallback;
  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) return fallback;
  const search = typeof from?.search === 'string' && from.search.startsWith('?') ? from.search : '';
  const hash = typeof from?.hash === 'string' && from.hash.startsWith('#') ? from.hash : '';
  return `${pathname}${search}${hash}`;
}
