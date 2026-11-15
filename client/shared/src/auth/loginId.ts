/**
 * The login id (Employee ID or username) the current session signed in with.
 *
 * Kept in memory only, for one reason: a Class C authorization that must be
 * completed with the password derives its proof from the login id, and asking
 * the person to retype an id they signed in with a minute ago is friction with
 * no security value. It is lost on reload, in which case the dialog asks.
 */
let current: string | undefined;

export function rememberLoginId(loginId: string): void {
  current = loginId.trim();
}

export function getRememberedLoginId(): string | undefined {
  return current;
}

export function forgetLoginId(): void {
  current = undefined;
}
