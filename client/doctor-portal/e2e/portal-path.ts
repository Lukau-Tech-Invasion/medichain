/** Resolve browser navigation against either a Vite root or the Docker portal. */
export function portalPath(path: string): string {
  const prefix = process.env.E2E_PORTAL_PREFIX?.replace(/\/$/, '') ?? '';
  if (!prefix || !path.startsWith('/') || path.startsWith('//') ||
      path === prefix || path.startsWith(`${prefix}/`)) return path;
  return `${prefix}${path}`;
}
