/**
 * Keep every open tab on the account that is actually signed in.
 *
 * One browser holds one session: the refresh cookie is shared by every tab.
 * Signing in as someone else in tab B replaced the cookie, but tab A kept the
 * previous person's name, role and screens in memory, and on its next token
 * refresh quietly became tab B's account behind them, refused at every turn.
 * The persisted sign-in (`localStorage`) fires a `storage` event in the other
 * tabs whenever it changes; when the signed-in person changes (a different
 * account, or nobody), those tabs reload into whoever is signed in now.
 * A write that leaves the same person signed in is ignored.
 */

/** The person a persisted auth-store value identifies, or `null` for nobody. */
export function signedInIdentity(value: string | null): string | null {
  if (!value) return null;
  try {
    const state = (JSON.parse(value) as { state?: Record<string, unknown> }).state ?? {};
    if (state.isAuthenticated !== true) return null;
    const person = (state.user ?? state.patient) as { userId?: unknown } | null | undefined;
    return typeof person?.userId === 'string' ? person.userId : null;
  } catch {
    return null;
  }
}

export function followSessionAcrossTabs(storageKey: string, target: Window = window): void {
  target.addEventListener('storage', (event) => {
    if (event.key !== storageKey && event.key !== null) return;
    // `key === null` is localStorage.clear() in another tab: nobody is signed in.
    const before = event.key === null ? 'cleared' : signedInIdentity(event.oldValue);
    const after = event.key === null ? null : signedInIdentity(event.newValue);
    if (before !== after) target.location.reload();
  });
}
