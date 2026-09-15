// `useApi` / `useMutation` lived here and had no callers in either portal --
// only this re-export. Removed 2026-09-10: what it offered a future caller was
// three dependency arrays the linter was right about, so adopting it would have
// meant inheriting stale-closure bugs from a generic wrapper. `useScoringCatalog`
// and `useProviderDirectory` below are the pattern that is actually in use.
// `AuthProvider` / `useAuth` lived here and had no consumers either -- both
// portals use their own Zustand `authStore`. Removed 2026-09-10, and not only
// as dead weight: it restored a session by reading a wallet address out of
// `localStorage` on mount and setting `isAuthenticated: true`, which is exactly
// the path `authStore.restoreSession` fails closed on by design -- no access
// token, refresh token or signing key is persisted, so nothing should survive a
// full page load. A dead weaker auth path beside the live one is a trap, not
// spare capacity.
export * from './useSidebarData';
export * from './useSSE';
export * from './useApiStatus';
export * from './useOfflineCache';
export * from './useProviderDirectory';
export * from './useScoringCatalog';
export * from './useStepUp';
